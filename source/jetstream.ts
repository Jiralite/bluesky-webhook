import type { APIEmbed } from "@discordjs/core";
import { CommitType, EventType, Jetstream } from "@skyware/jetstream";
import { discord } from "./discord.js";
import type { WebhooksPacket } from "./models/webhook.js";
import pg from "./pg.js";
import { BLUESKY_ICON, DatabaseTable } from "./utility/constants.js";
import { embedLinksInText, fetchProfile, formatImageURL } from "./utility/functions.js";

const LAST_SEEN_POSTS = new Map<string, string>();

async function generateOptions() {
	const wantedDIDs = (await pg<WebhooksPacket>(DatabaseTable.Webhooks).distinct("did")).map(
		(row) => row.did,
	);

	const wantedDIDsSet = new Set(wantedDIDs);

	for (const key of LAST_SEEN_POSTS.keys()) {
		if (!wantedDIDsSet.has(key)) {
			LAST_SEEN_POSTS.delete(key);
		}
	}

	return {
		wantedCollections: ["app.bsky.feed.post" as const],
		wantedDids: wantedDIDs,
	};
}

export const jetstream = new Jetstream(await generateOptions());

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This is fine.
jetstream.on(EventType.Commit, async (event) => {
	console.log(event);

	if (event.commit.operation === CommitType.Create) {
		if (event.commit.record.reply) {
			// Ignore replies.
			return;
		}

		const did = event.did;

		// https://github.com/bluesky-social/jetstream#consuming-jetstream
		if (LAST_SEEN_POSTS.get(did) === event.commit.rkey) {
			console.log(`Skipping ${did} (duplicate check).`);
			return;
		}

		LAST_SEEN_POSTS.set(did, event.commit.rkey);

		// Get all webhooks for this DID.
		const webhooks = await pg<WebhooksPacket>(DatabaseTable.Webhooks).where({ did });

		if (webhooks.length === 0) {
			// No webhooks are listening to this DID.
			await updateOptions();
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
			description = embedLinksInText(
				description,
				// @ts-expect-error Type conflict, but it will work.
				record.facets,
			);
		}

		const url = `https://bsky.app/profile/${did}/post/${rkey}`;
		let displayName: string | undefined;
		let handle: string | undefined;
		let avatar: string | undefined;

		try {
			({ displayName, handle, avatar } = await fetchProfile(did));
		} catch (error) {
			// DID probably does not exist.
			console.log(error);
		}

		const initialEmbed: APIEmbed = {
			description: `${description}\n\n-# [View Post](${url})`,
			url,
			timestamp: record.createdAt,
			color: 0x0385ff,
		};

		if (handle) {
			initialEmbed.footer = { icon_url: BLUESKY_ICON, text: handle };
		}

		const firstURL = embedImages.shift();

		if (firstURL) {
			initialEmbed.image = { url: firstURL };
		}

		const embeds: APIEmbed[] = [initialEmbed];

		for (const embedImage of embedImages) {
			embeds.push({ url, image: { url: embedImage } });
		}

		const promises = webhooks.map(({ id, token }) =>
			discord.webhooks.execute(id, token, {
				username: displayName ?? handle,
				avatar_url: avatar,
				embeds,
			}),
		);

		await Promise.all(promises);
	}
});

jetstream.on("error", console.log);

export async function updateOptions() {
	jetstream.updateOptions(await generateOptions());
}
