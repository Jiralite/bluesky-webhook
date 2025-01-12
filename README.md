# Bluesky Webhook

Executes a Discord webhook upon a new post.

## Setup

Make a `POST` request to https://bluesky-webhook.jiralite.dev. Use the following JSON payload:

| Parameter | Description                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | Id of the webhook.                                                                                                              |
| `token`   | Token of the webhook.                                                                                                           |
| `did`     | The [DID](https://docs.bsky.app/docs/advanced-guides/resolving-identities). There are tools online to find a DID from a handle. |

If successful, the webhook will be executed upon a new post of the DID. In other words, you'll receive a message whenever that Bluesky user posts.

### Example

```
curl "https://serebii-webhook.jiralite.workers.dev" \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{"id":"1234567890123456789","token":"webhook-token","did":"did:plc:exampletext"}'
```

## Support

Open a [discussion](https://github.com/Jiralite/bluesky-webhook/discussions/new?category=support) if you need assistance.
