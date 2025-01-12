import type { AppBskyRichtextFacet } from "@atcute/client/lexicons";

export function getCharacterIndexesFromByteOffsets(
	description: string,
	{ byteStart, byteEnd }: AppBskyRichtextFacet.ByteSlice,
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

export function formatImageURL(did: string, id: string) {
	return `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${id}`;
}

interface Profile {
	handle: string;
	displayName?: string;
	avatar?: string;
}

export async function fetchProfile(did: string) {
	const response = await fetch(
		`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${did}`,
		{ method: "GET" },
	);

	if (!response.ok) {
		throw await response.json();
	}

	const json = (await response.json()) as Profile;
	return json;
}
