import pg from "../pg.js";
import { DatabaseTable } from "../utility/constants.js";

export interface WebhooksPacket {
	id: string;
	token: string;
	did: string;
}

interface DeleteWebhookOptions {
	id: string;
	token: string;
}

export async function deleteWebhook(options: DeleteWebhookOptions) {
	await pg<WebhooksPacket>(DatabaseTable.Webhooks).delete().where(options);
}

export class WebhookExecuteError {
	public readonly webhook: WebhooksPacket;

	public readonly error: unknown;

	public constructor(webhook: WebhooksPacket, error: unknown) {
		this.webhook = webhook;
		this.error = error;
	}
}
