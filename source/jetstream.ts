import type { APIEmbed } from "@discordjs/core";
import { CommitType, EventType, Jetstream } from "@skyware/jetstream";
import { discord } from "./discord.js";
import type { WebhooksPacket } from "./models/webhook.js";
import pg from "./pg.js";
import { DatabaseTable } from "./utility/constants.js";
import {
	fetchProfile,
	formatImageURL,
	getCharacterIndexesFromByteOffsets,
} from "./utility/functions.js";

async function generateOptions() {
	return {
		wantedCollections: ["app.bsky.feed.post" as const],
		wantedDids: (await pg<WebhooksPacket>(DatabaseTable.Webhooks).distinct("did")).map(
			(row) => row.did,
		),
	};
}

export const jetstream = new Jetstream(await generateOptions());

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
			initialEmbed.footer = { text: handle };
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

export async function updateOptions() {
	jetstream.updateOptions(await generateOptions());
}
