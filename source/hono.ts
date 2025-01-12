import { RESTJSONErrorCodes } from "@discordjs/core";
import { DiscordAPIError } from "@discordjs/rest";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { discord } from "./discord.js";
import { updateOptions } from "./jetstream.js";
import type { WebhooksPacket } from "./models/webhook.js";
import pg from "./pg.js";
import { DatabaseTable } from "./utility/constants.js";
import { fetchProfile } from "./utility/functions.js";

export const app = new Hono({ strict: true });

app.post(
	"/",
	zValidator(
		"json",
		z.object({
			id: z.string().regex(/^\d{17,19}$/, "Invalid id."),
			token: z.string(),
			did: z.string().regex(/^did:plc:[a-z0-9]{16,}$/, "Invalid DID."),
		}),
		(result, context) => {
			if (!result.success) {
				return context.json({ error: result.error.flatten() }, { status: 400 });
			}

			return;
		},
	),
	async (context) => {
		const json = context.req.valid("json");

		// Does this already exist?
		const existing = await pg<WebhooksPacket>(DatabaseTable.Webhooks).where(json).first();

		if (existing) {
			return context.body(null, 204);
		}

		// Does the webhook exist?
		try {
			await discord.webhooks.get(json.id, { token: json.token });
		} catch (error) {
			if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownWebhook) {
				return context.json({ message: "Invalid webhook." }, { status: 400 });
			}

			console.log(error);
			return context.json({ message: "Internal server error." }, { status: 500 });
		}

		// Does the DID exist?
		try {
			await fetchProfile(json.did);
		} catch (error) {
			console.log(error);
			return context.json({ message: "Invalid DID." }, { status: 400 });
		}

		await pg<WebhooksPacket>(DatabaseTable.Webhooks).insert(json);
		await updateOptions();
		return context.json({ success: true });
	},
);

app.onError((handler) => {
	console.log(handler);
	return Response.json({ message: "Internal server error." }, { status: 500 });
});
