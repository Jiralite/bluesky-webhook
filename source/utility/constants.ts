import process from "node:process";

if (!process.env.DATABASE_URL) {
	throw new Error("Database URL missing.");
}

export const DATABASE_URL = process.env.DATABASE_URL;

export enum DatabaseTable {
	Webhooks = "webhooks",
}

export const BLUESKY_ICON = "https://bsky.app/static/apple-touch-icon.png" as const;
