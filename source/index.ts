const SNOWFLAKE_REGULAR_EXPRESSION = /^\d{17,19}$/;
const SEREBII_DID_ENCODED = encodeURIComponent("did:plc:fhf5k5lbggppbc26y5ir2cli");

interface WebhooksData {
	id: string;
	token: string;
}

interface QueuePayload {
	id: string;
	token: string;
	body: unknown;
}

interface Env {
	database: D1Database;
	queue: Queue<QueuePayload>;
}

interface Author {
	handle: string;
	displayName?: string;
	avatar?: string;
}

interface FacetFeature {
	$type:
		| "app.bsky.richtext.facet#link"
		| "app.bsky.richtext.facet#mention"
		| "app.bsky.richtext.facet#tag";
	uri: string;
}

interface FacetIndex {
	byteEnd: number;
	byteStart: number;
}

interface Facet {
	features: [FacetFeature];
	index: FacetIndex;
}

interface Record {
	createdAt: string;
	facets?: Facet[];
	text: string;
}

interface EmbedImage {
	fullsize: string;
}

interface EmbedWithImage {
	images: EmbedImage[];
}

interface EmbedWithVideo {
	thumbnail?: string;
}

interface EmbedExternal {
	thumb?: string;
}

interface EmbedWithExternal {
	external: EmbedExternal;
}

type Embed = EmbedWithImage | EmbedWithVideo | EmbedWithExternal;

interface Post {
	uri: string;
	author: Author;
	record: Record;
	embed?: Embed;
}

interface Feed {
	post: Post;
}

interface AuthorFeedResponse {
	feed: Feed[];
}

export interface DiscordEmbedImage {
	url: string;
	proxy_url?: string;
}

export interface DiscordEmbedAuthor {
	name: string;
	url?: string;
	icon_url?: string;
	proxy_icon_url?: string;
}

export interface DiscordEmbedFooter {
	text: string;
	icon_url?: string;
	proxy_icon_url?: string;
}

export interface DiscordEmbed {
	title?: string;
	description?: string;
	url?: string;
	timestamp?: string;
	color?: number;
	footer?: DiscordEmbedFooter;
	image?: DiscordEmbedImage;
	author?: DiscordEmbedAuthor;
}

function getCharacterIndexesFromByteOffsets(
	description: string,
	{ byteStart, byteEnd }: FacetIndex,
) {
	const encoder = new TextEncoder();
	let currentByteIndex = 0;
	let startIndex = -1;
	let endIndex = -1;

	for (let index = 0; index < description.length; index++) {
		const encodedChar = encoder.encode(description[index]);
		const charByteLength = encodedChar.length;

		if (currentByteIndex === byteStart) {
			startIndex = index;
		}

		if (currentByteIndex + charByteLength >= byteEnd && endIndex === -1) {
			endIndex = index + 1;
			break;
		}

		currentByteIndex += charByteLength;
	}

	return { startIndex, endIndex };
}

export default {
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This is fine.
	async scheduled(_, env) {
		const request = await fetch(
			`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${SEREBII_DID_ENCODED}&limit=100&filter=posts_no_replies`,
			{
				method: "GET",
			},
		);

		if (!request.ok) {
			console.log("Failed to get author feed.", {
				statusText: request.statusText,
				status: request.status,
			});

			return;
		}

		const json = (await request.json()) as AuthorFeedResponse;

		const lastCreatedAt = (
			await env.database.prepare("select created_at from general").first<{ created_at: string }>()
		)?.created_at;

		const feed = lastCreatedAt
			? json.feed.filter(
					(feed) =>
						new Date(feed.post.record.createdAt).getTime() > new Date(lastCreatedAt).getTime(),
				)
			: json.feed;

		if (feed.length === 0) {
			console.log("No new posts.");
			return;
		}

		console.log({ lastCreatedAt, posts: feed.length });

		await env.database
			.prepare("insert or replace into general (id, created_at) values (1, ?)")
			.bind(feed[0]!.post.record.createdAt)
			.run();

		const webhooks = await env.database.prepare("SELECT * FROM webhooks").all<WebhooksData>();

		if (webhooks.results.length === 0) {
			console.log("No webhooks.");
			return;
		}

		for (const { post } of feed.reverse()) {
			const { uri, author, record, embed } = post;
			const { handle } = author;
			let embedImages: string[] = [];

			if (embed) {
				if ("images" in embed) {
					embedImages = embed.images.map((image) => image.fullsize);
				} else if ("thumbnail" in embed) {
					embedImages = [embed.thumbnail];
				} else if ("external" in embed && embed.external.thumb) {
					embedImages = [embed.external.thumb];
				}
			}

			await env.queue.sendBatch(
				// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This is fine.
				webhooks.results.map(({ id, token }) => {
					let description = record.text;

					if (record.facets) {
						const replacements: { startIndex: number; endIndex: number; hyperlink: string }[] = [];

						for (const { features, index } of record.facets) {
							if (features[0].$type !== "app.bsky.richtext.facet#link") {
								continue;
							}

							const { startIndex, endIndex } = getCharacterIndexesFromByteOffsets(
								record.text,
								index,
							);

							if (startIndex !== -1 && endIndex !== -1) {
								const hyperlink = `[${record.text.slice(startIndex, endIndex)}](${features[0].uri})`;
								replacements.push({ startIndex, endIndex, hyperlink });
							} else {
								console.error("Could not determine character indexes from byte offsets.");
							}
						}

						for (const { startIndex, endIndex, hyperlink } of replacements.sort(
							(a, b) => b.startIndex - a.startIndex,
						)) {
							description = `${description.slice(0, startIndex)}${hyperlink}${description.slice(endIndex)}`;
						}
					}

					const url = `https://bsky.app/profile/${handle}/post/${uri.slice(uri.lastIndexOf("/") + 1)}`;

					const initialEmbed: DiscordEmbed = {
						title: author.displayName ?? handle,
						description,
						url,
						timestamp: record.createdAt,
						color: 0x67bd3f,
						footer: { text: handle },
					};

					const firstURL = embedImages.shift();

					if (firstURL) {
						initialEmbed.image = { url: firstURL };
					}

					const embeds: DiscordEmbed[] = [initialEmbed];

					for (const embedImage of embedImages) {
						embeds.push({ url, image: { url: embedImage } });
					}

					return {
						body: {
							id,
							token,
							body: {
								username: "Serebii",
								avatar_url: author.avatar,
								embeds,
							},
						},
					};
				}),
			);
		}
	},
	async fetch(request, env) {
		if (request.method === "GET") {
			return Response.redirect("https://github.com/Jiralite/serebii-webhook", 301);
		}

		if (request.method !== "POST") {
			return new Response("Method not allowed.", { status: 405 });
		}

		let body: Partial<WebhooksData>;

		try {
			body = await request.json();
		} catch (error) {
			console.error(error);
			return new Response("Invalid JSON.", { status: 400 });
		}

		const { id, token } = body;

		if (!(id && token)) {
			return new Response("Missing data.", { status: 400 });
		}

		if (!SNOWFLAKE_REGULAR_EXPRESSION.test(id)) {
			return new Response("Invalid id.", { status: 400 });
		}

		try {
			await env.database
				.prepare("insert into webhooks (id, token) values (?, ?)")
				.bind(id, token)
				.run();
		} catch (error) {
			console.error(error);
			return new Response("Data already exists.", { status: 409 });
		}

		return new Response(JSON.stringify({ id, token, message: "Registered!" }), {
			headers: { "Content-Type": "application/json" },
		});
	},
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This is fine.
	async queue(batch, env) {
		// Get the current webhooks to check just before sending.
		const webhooks = (await env.database.prepare("select * from webhooks").all<WebhooksData>())
			.results;

		// Filter out webhooks that are not in the database.
		let messages = batch.messages.filter((message) => {
			const { id, token } = message.body as QueuePayload;
			return webhooks.some((webhook) => webhook.id === id && webhook.token === token);
		}) as Message<QueuePayload>[];

		// Order by timestamps.
		const uniqueDates = [
			...new Set<string>(
				messages.map(
					(message) =>
						// @ts-expect-error Unknown.
						message.body.body.embeds[0].timestamp,
				),
			),
		].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

		console.log({ uniqueDates });
		let index = 0;

		// Iterate over the dates.
		for (const uniqueDate of uniqueDates) {
			index++;

			// Filter the messages to only include the current date.
			const filteredMessages = messages.filter(
				(message) =>
					// @ts-expect-error Unknown.
					message.body.body.embeds[0].timestamp === uniqueDate,
			);

			const webhookExecuteData = filteredMessages.map((message) => {
				const { id, token, body } = message.body;

				return {
					message,
					request: fetch(`https://discord.com/api/webhooks/${id}/${token}`, {
						headers: {
							"Content-Type": "application/json",
						},
						method: "POST",
						body: JSON.stringify(body),
					}),
				};
			});

			const settled = await Promise.allSettled(webhookExecuteData.map(({ request }) => request));

			for (let index = 0; index < settled.length; index++) {
				const result = settled[index]!;
				const { message } = webhookExecuteData[index]!;
				const { id, token } = message.body;

				if (result.status === "fulfilled") {
					if (result.value.status === 429) {
						// Rate limit. Retry this.
						message.retry();
						continue;
					}

					if (result.value.status === 404) {
						// Webhook no longer exists. Remove it.
						await env.database
							.prepare("delete from webhooks where id = ? and token = ?")
							.bind(id, token)
							.run();

						// Filter the array of messages to remove the webhook.
						messages = messages.filter((message) => {
							const { id: webhookId, token: webhookToken } = message.body;
							return webhookId !== id && webhookToken !== token;
						});
					}
				} else if (result.status === "rejected") {
					console.error(`Failed to execute webhook ${id}.`, result.reason);
				}
			}

			if (index % 5 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 5000));
			}
		}
	},
} satisfies ExportedHandler<Env>;
