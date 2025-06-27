
# HoseWatcher

A real-time Bluesky firehose relay built on Cloudflare Workers. This service connects to the Bluesky firehose, processes the AtProto events, and relays them to clients via WebSockets.
<div align="center">

[![MADE BY #V0ID](https://img.shields.io/badge/MADE%20BY%20%23V0ID-F3EEE1.svg?style=for-the-badge)](https://github.com/v0id-user)

</div>
## 🚰 What is HoseWatcher?

HoseWatcher is a relay server that streams real-time data from the Bluesky firehose to connected clients. The Bluesky firehose provides a continuous stream of all activities happening on the Bluesky social network (posts, likes, follows, etc.).

This project was inspired by a similar concept that used the Twitter firehose (as mentioned in the code comments referencing a [YouTube video](https://www.youtube.com/watch?v=fxZSP85YcoE)).

## 🛠️ Technical Overview

HoseWatcher is built on:
- Cloudflare Workers for serverless deployment
- WebSockets for real-time communication
- CBOR (Concise Binary Object Representation) for decoding the AtProto events

The service acts as a middleman between clients and the Bluesky firehose:
1. Clients connect to HoseWatcher via WebSocket
2. HoseWatcher maintains a connection to the Bluesky firehose
4. Events from the firehose are decoded from CBOR format
5. Processed events are relayed to clients as JSON

## 🚀 Getting Started

### Prerequisites
- Cloudflare account
- Node.js and npm installed

### Installation

1. Clone the repository
```bash
git clone https://github.com/v0id-user/hosewatcher.git
cd hosewatcher
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables in your wrangler.jsonc:
```json
"vars": {
  "HOSER_ENDPOINT": "your-worker-endpoint",
  "DEBUG": false
}
```

4. Deploy to Cloudflare
```bash
npm run deploy
```

### Usage

1. Connect to the WebSocket endpoint
2. Start receiving real-time events from the Bluesky network

## 🔍 How It Works

The server handles two main types of connections:
- HTTP requests for basic info
- WebSocket connections for streaming data

When a client connects via WebSocket:
1. The server establishes a connection to the Bluesky firehose
2. The server decodes incoming CBOR-encoded events
3. Decoded events are forwarded to the client in JSON format

## 🙏 Credits & Inspiration

This project draws inspiration and code from:
- The implementation of a Twitter firehose visualizer from a [YouTube video](https://www.youtube.com/watch?v=fxZSP85YcoE)
- [ATProto Firehose implementation](https://github.com/kcchu/atproto-firehose) by kcchu
- The [ATProto Documentation](https://docs.bsky.app/docs/advanced-guides/firehose) for understanding firehose handling
- [CBOR specifications](https://cbor.io/) for handling the binary data format

## 👤 Author

Made with ❤️ by [@v0id_user](https://x.com/v0id_user)  
GitHub: [https://github.com/v0id-user](https://github.com/v0id-user)  
Website: [https://tree.v0id.me](https://tree.v0id.me)

## 📝 License

MIT License
