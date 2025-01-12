import { API } from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { CommitType, EventType, Jetstream } from "@skyware/jetstream";
import { request } from "undici";
import pg from "./pg.js";
import { DatabaseTable } from "./utility/constants.js";
import { formatImageURL, getCharacterIndexesFromByteOffsets } from "./utility/functions.js";

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

interface WebhooksPacket {
	id: string;
	token: string;
	did: string;
}

const jetstream = new Jetstream({
	wantedCollections: ["app.bsky.feed.post"],
	wantedDids: (await pg<WebhooksPacket>(DatabaseTable.Webhooks).distinct("did")).map(
		(row) => row.did,
	),
});

const api = new API(new REST({ version: "10" }));

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This is fine.
jetstream.on(EventType.Commit, async (event) => {
	console.log(JSON.stringify(event, null, 2));

	if (event.commit.operation === CommitType.Create) {
		const did = event.did;

		// Get all webhooks for this DID.
		const webhooks = await pg<WebhooksPacket>(DatabaseTable.Webhooks).where({ did });

		if (webhooks.length === 0) {
			// No webhooks are listening to this DID.
			return;
		}

		const { record, rkey } = event.commit;
		const { embed } = record;
		let embedImages: string[] = [];

		if (embed?.$type === "app.bsky.embed.images") {
			embedImages = embed.images.map(({ image }) => formatImageURL(did, image.ref.$link));
		}

		let description = record.text;

		if (record.facets) {
			const replacements: { startIndex: number; endIndex: number; hyperlink: string }[] = [];

			for (const { features, index } of record.facets) {
				if (features[0]?.$type !== "app.bsky.richtext.facet#link") {
					continue;
				}

				const { startIndex, endIndex } = getCharacterIndexesFromByteOffsets(record.text, index);

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

		const url = `https://bsky.app/profile/${did}/post/${rkey}`;

		const response = await request("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile", {
			method: "GET",
			query: { actor: did },
		});

		let displayName: string | undefined;
		let handle: string | undefined;
		let avatar: string | undefined;

		if (response.statusCode === 200) {
			const profile = (await response.body.json()) as {
				handle: string;
				displayName?: string;
				avatar?: string;
			};

			displayName = profile.displayName;
			handle = profile.handle;
			avatar = profile.avatar;
		}

		const initialEmbed: DiscordEmbed = {
			description: `${description}\n\n-# [View Post](${url})`,
			url,
			timestamp: record.createdAt,
			color: 0x0385ff,
		};

		if (handle) {
			initialEmbed.footer = { text: handle };
		}

		const firstURL = embedImages.shift();

		if (firstURL) {
			initialEmbed.image = { url: firstURL };
		}

		const embeds: DiscordEmbed[] = [initialEmbed];

		for (const embedImage of embedImages) {
			embeds.push({ url, image: { url: embedImage } });
		}

		const promises = webhooks.map(({ id, token }) =>
			api.webhooks.execute(id, token, {
				username: displayName ?? handle,
				avatar_url: avatar,
				embeds,
			}),
		);

		await Promise.all(promises);
	}
});

jetstream.start();
