// All imports
import * as cborx from 'cbor-x'
import { CID } from 'multiformats/cid'
import { COMMIT_EVENT_TYPE } from './constants/atprotoEventsTypes'
import { BSKY_POST } from './constants/dataModelTypes'
import { AtProtoCommitEventBody } from './interfaces/atprotoEvents'
import { CarReader } from '@ipld/car/reader'
import { decode as ipldCborDecode } from '@ipld/dag-cbor'
import { PostEventDataModel } from './interfaces/eventDataModel'
import { HoseDataPost } from './interfaces/hoseData'

// TODO: use await agent.getPost(params)

/* I copied the same decoder from the implementation of the Atproto decoder @atproto/common
* found in https://github.dev/bluesky-social/atproto/blob/main/packages/common/src/index.ts
* I tried to use the library @atproto/common but it was not working as expected with cloudflare workers
* ==============@Atproto/common START==================
*/

// add extension for decoding CIDs
// decoding code taken from @ipld/dag-cbor
// does not support encoding cids
cborx.addExtension({
  Class: CID,
  tag: 42,
  encode: () => {
    throw new Error('cannot encode cids')
  },
  decode: (bytes: Uint8Array): CID => {
    if (bytes[0] !== 0) {
      throw new Error('Invalid CID for CBOR tag 42; expected leading 0x00')
    }
    return CID.decode(bytes.subarray(1)) // ignore leading 0x00
  },
})

const decoder = new cborx.Decoder({
  // @ts-ignore
  int64AsNumber: true, // not in types for some reason
  useRecords: false,
})

export const cborDecodeMulti = (encoded: Uint8Array): unknown[] => {
  const decoded: unknown[] = []
  decoder.decodeMultiple(encoded, (value) => {
    decoded.push(value)
  })
  return decoded
}

/*
* ==============@Atproto/common END==================
*/

/**
 * ==============My parser implementation START==================
 * 
 * In this parser I will try to simplify the event data and extract
 * the most useful information from it.
 * 
 * 
 * Resources can be found in:
 * 
 * - https://atproto.com/specs/event-stream#Framing "Talking about the event frame and parts"
 */


/**
 * Header of the event
 * based on the type definition of the header 
 * in the event stream spec in
 * 
 * Details about data header and types can be found in:
 * - https://atproto.com/specs/sync
 */
interface AtProtoEventHeader {
  op: 1 | -1; // Operation 1 is a commit, -1 is an error
  t?: "#commit" | "#account"; // Type of the event
}

async function parseAtProtoEvent(event: Uint8Array) {
  try {
    const [header, body] = cborDecodeMulti(event) as [AtProtoEventHeader, unknown];

    /**
     * `op` ("operation", integer, required): fixed values, indicating what this frame contains
     * 1: a regular message, with type indicated by `t`
     * -1: an error message
     * `t` ("type", string, optional): required if `op` is 1, indicating the Lexicon sub-type for this 
     *                                 message, in short form. Does not include the full Lexicon identifier, 
     *                                 just a fragment. Eg: #commit. Should not be included in header if op is -1.
     */

    // Handle error messages
    if (header.op === -1) {
      // I might not ignore this, by for sake of simplicity I will ignore it
      return null;
    }

    // Handle unknown op/t values
    if (!header.op || !header.t) {
      /* ignore unknown op or t values
      * as stated in the spec:
      * Clients should ignore frames with headers that have unknown op or t values. 
      * Unknown fields in both headers and payloads should be ignored. Invalid framing or invalid DAG-CBOR 
      * encoding are hard errors, and the client should drop the entire connection instead of skipping the frame. 
      * Servers should ignore any frames received from the client, not treat them as errors.
      */
      return null;
    }

    // Handle non-commit events
    if (header.t !== COMMIT_EVENT_TYPE) {
      return null;
    }

    const hoseEvent = body as AtProtoCommitEventBody;

    // Validate ops array exists and has elements
    if (!hoseEvent.ops || !Array.isArray(hoseEvent.ops) || !hoseEvent.ops[0]) {
      return null;
    }

    // Skip too big or deleted events
    if (hoseEvent.tooBig || hoseEvent.ops[0].action === 'delete') {
      return null;
    }

    /* 
    * Decoding the blocks taken from https://github.com/kcchu/atproto-firehose/blob/main/src/subscribeRepos.ts#L64
    * and the specs in https://atproto.com/specs/sync
    * 
    * The block are encoded in CAR format, so we need to decode them
    * 
    * more about the CAR format can be found in:
    * - https://ipld.io/specs/transport/car/carv1/#summary
    * 
    * Also you need to know about the CIDs because it relates to the blocks:
    * - https://github.com/multiformats/cid
    */

    // Validate CID exists
    if (!hoseEvent.ops[0].cid) {
      return null;
    }

    // Decode CAR format
    const cr = await CarReader.fromBytes(hoseEvent.blocks);
    if (!cr) {
      return null;
    }

    // Get block from CID
    const block = await cr.get(hoseEvent.ops[0].cid as any);
    if (!block) {
      return null;
    }

    // Decode block
    const decodedBlock = ipldCborDecode(block.bytes);
    if (!decodedBlock || typeof decodedBlock !== 'object') {
      return null;
    }

    const blockType = decodedBlock as { $type: string; };

    /**
     * Now we finished dealing with sync events and started dealing with
     * Data models, each event has a $type maybe a like, reply, post, etc.
     * 
     * We need to check for the $type and then parse the event accordingly
     */
    if (blockType.$type !== BSKY_POST) {
      return null;
    }

    /**
     * For posts we want to get the author and more data so we will use @atproto/api
     * for sake of simplicity.
     * 
     * We will use .getPost(params) to get the post data.
     * 
     * It requires a repo and a rkey.
     * 
     * These values can be found in the orginal event data or extracted from the URI.
     *
     * URI Schema: 
     * at://" AUTHORITY [ PATH ] [ "?" QUERY ] [ "#" FRAGMENT ]
     * 
     * - https://atproto.com/specs/at-uri-scheme
     * 
     * Author is the authority part of the URI, which is a did:plc Decentralized Identifier:Public Ledger of Credentials,
     * As mentioned in the spec:
     * - https://atproto.com/specs/did
     * - https://www.w3.org/TR/did-1.0/
     * - https://web.plc.directory/
     * 
     * We need to do a resolution for the did:plc to get the web handle for it.
     * 
     * I will use the https://plc.directory/{did} API to do the resolution.
     * 
     */

    /*
    * ! Change: 
    * We will return a parsed raw sync event the client is responsible for extracting the data
    * or any other details needed, the reason is that if we do it here we will need to make multiple
    * requests to other services to get the data, and it will increase the complexity of the code and latency.
    * 
    * Also we will face rate limiting issues, so it's better to let the client handle the data.
    * and we provide wrapper endpoints to other needed data.
    * 
    */
    const postModel = decodedBlock as PostEventDataModel;

    // TODO: Include DID and RKEY in the response
    const hoseData: HoseDataPost = {
      text: postModel.text || '',
      createdAt: postModel.createdAt,
      reply: postModel.reply ? {
        parent: {
          uri: postModel.reply.parent.uri
        }
      } : undefined,
      tags: postModel.facets?.filter(f => f.features?.some(feat => feat.$type === 'app.bsky.richtext.facet#tag'))
        .map(f => f.features?.find(feat => feat.tag)?.tag).filter(Boolean) as string[],
      mentions: postModel.facets?.filter(f => f.features?.some(feat => feat.$type === 'app.bsky.richtext.facet#mention'))
        .map(f => f.features?.find(feat => feat.did)?.did).filter(Boolean) as string[]
    };

    if (!hoseData.text) {
      return {};
    }

    return hoseData;

  } catch (error) {
    console.error('Error processing event:', error);
    return null;
  }
}

export { parseAtProtoEvent }

/**
 * ==============My parser implementation END==================
 */