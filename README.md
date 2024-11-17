# Serebii Webhook

Gotta post 'em all!

## Description

Monitors Serebii's [Bluesky profile](https://bsky.app/profile/did:plc:fhf5k5lbggppbc26y5ir2cli) for new posts and executes a webhook.

## Setup

Make a `POST` request to https://serebii-webhook.jiralite.workers.dev. Use the following JSON payload:

| Parameter | Description           |
| --------- | --------------------- |
| `id`      | Id of the webhook.    |
| `token`   | Token of the webhook. |

### Example

```
curl "https://serebii-webhook.jiralite.workers.dev" \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{"id": "1234567890123456789", "token": "webhook-token"}'
```

## Support

Open a [discussion](https://github.com/Jiralite/serebii-webhook/discussions/new?category=support) if you need assistance.
