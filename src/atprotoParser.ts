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


/* I copied the same decoder from the implementation of the Atproto decoder @atproto/common
* found in https://github.com/bluesky-social/atproto/blob/main/packages/common/src/ipld-multi.ts
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
  if (!encoded || !(encoded instanceof Uint8Array) || encoded.length === 0) {
    return [];
  }

  try {
    const decoded: unknown[] = []
    decoder.decodeMultiple(encoded, (value) => {
      decoded.push(value)
    })
    return decoded
  } catch (error) {
    console.error('CBOR decode error:', error);
    return [];
  }
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

/**
 * Parses CBOR data into header and body
 * Returns null if parsing fails
 */
function decodeEvent(event: Uint8Array): [AtProtoEventHeader, unknown] | null {
  if (!event || !(event instanceof Uint8Array) || event.length === 0) {
    console.warn('Invalid event data received: empty or not Uint8Array');
    return null;
  }

  try {
    const decoded = cborDecodeMulti(event);
    if (!Array.isArray(decoded) || decoded.length < 2) {
      console.warn(`Invalid decoded data: expected array with at least 2 elements, got ${decoded?.length || 0} elements`);
      return null;
    }

    // Validate header structure
    const header = decoded[0] as AtProtoEventHeader;
    if (!header || typeof header !== 'object') {
      console.warn('Invalid header: not an object');
      return null;
    }

    return decoded as [AtProtoEventHeader, unknown];
  } catch (error) {
    console.error('Error decoding CBOR data:', error);
    return null;
  }
}

/**
 * Validates event header
 * Returns false if invalid
 */
function validateHeader(header: AtProtoEventHeader | null): boolean {
  if (!header) return false;

  // Handle error messages
  if (header.op === -1) {
    return false;
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
    return false;
  }

  // Handle non-commit events
  if (header.t !== COMMIT_EVENT_TYPE) {
    return false;
  }

  return true;
}

/**
 * Validates commit event body
 * Returns null if invalid
 */
function validateCommitEvent(hoseEvent: AtProtoCommitEventBody): boolean {
  // Validate ops array exists and has elements
  if (!hoseEvent || !hoseEvent.ops || !Array.isArray(hoseEvent.ops) || !hoseEvent.ops[0]) {
    return false;
  }

  // Skip too big or  events
  if (hoseEvent.tooBig || hoseEvent.ops[0].action === 'delete') {
    return false;
  }

  // Validate CID exists
  if (!hoseEvent.ops[0].cid) {
    return false;
  }

  return true;
}

/**
 * Extracts tags from facets
 */
function extractTags(facets: any[] | undefined): string[] {
  if (!facets || !Array.isArray(facets)) return [];

  return facets
    .filter(f => f && f.features && Array.isArray(f.features) &&
      f.features.some((feat: { $type?: string }) => feat && feat.$type === 'app.bsky.richtext.facet#tag'))
    .map(f => {
      const tagFeature = f.features?.find((feat: { $type?: string; tag?: string }) => feat && feat.tag);
      return tagFeature && tagFeature.tag ? tagFeature.tag : null;
    })
    .filter(Boolean) as string[];
}

/**
 * Extracts mentions from facets
 */
function extractMentions(facets: any[] | undefined): string[] {
  if (!facets || !Array.isArray(facets)) return [];

  return facets
    .filter(f => f && f.features && Array.isArray(f.features) &&
      f.features.some((feat: { $type?: string }) => feat && feat.$type === 'app.bsky.richtext.facet#mention'))
    .map(f => {
      const mentionFeature = f.features?.find((feat: { $type?: string; did?: string }) => feat && feat.did);
      return mentionFeature && mentionFeature.did ? mentionFeature.did : null;
    })
    .filter(Boolean) as string[];
}

/**
 * Processes CAR block to extract post data
 */
async function processCarBlock(hoseEvent: AtProtoCommitEventBody): Promise<PostEventDataModel | null> {
  try {
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

    // Safety check for blocks
    if (!hoseEvent.blocks || !(hoseEvent.blocks instanceof Uint8Array)) {
      return null;
    }

    // Decode CAR format
    const cr = await CarReader.fromBytes(hoseEvent.blocks);
    if (!cr) {
      return null;
    }

    // Get block from CID
    const cid = hoseEvent.ops[0]?.cid;
    if (!cid) return null;

    const block = await cr.get(cid as any);
    if (!block) {
      return null;
    }

    // Decode block
    const decodedBlock = ipldCborDecode(block.bytes);
    if (!decodedBlock || typeof decodedBlock !== 'object') {
      return null;
    }

    const blockType = decodedBlock as { $type?: string };

    /**
     * Now we finished dealing with sync events and started dealing with
     * Data models, each event has a $type maybe a like, reply, post, etc.
     * 
     * We need to check for the $type and then parse the event accordingly
     * 
     * for this implementation I will only parse posts
     */
    if (!blockType.$type || blockType.$type !== BSKY_POST) {
      return null;
    }

    return decodedBlock as PostEventDataModel;
  } catch (error) {
    console.error('Error processing CAR block:', error);
    return null;
  }
}

async function parseAtProtoEvent(event: Uint8Array) {
  try {
    if (!event || !(event instanceof Uint8Array)) {
      console.warn('Invalid event: not a Uint8Array');
      return {};
    }

    const decodedData = decodeEvent(event);
    if (!decodedData) return {};

    const [header, body] = decodedData;

    if (!validateHeader(header)) return {};

    const hoseEvent = body as AtProtoCommitEventBody;
    if (!validateCommitEvent(hoseEvent)) return {};

    const postModel = await processCarBlock(hoseEvent);
    if (!postModel) return {};

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
     * 
     * +===============================================================================================================================================+
     * 
     * 
     * ! Change: 
     * We will return a parsed raw sync event the client is responsible for extracting the data
     * or any other details needed, the reason is that if we do it here we will need to make multiple
     * requests to other services to get the data, and it will increase the complexity of the code and latency.
     * 
     * Also we will face rate limiting issues, so it's better to let the client handle the data.
     * and we provide wrapper endpoints to other needed data.
     * 
    */

    try {
      const hoseData: HoseDataPost = {
        text: postModel.text || '',
        did: hoseEvent.repo || '',
        rev: hoseEvent.rev || '',
        createdAt: postModel.createdAt || '',
        reply: postModel.reply && postModel.reply.parent ? {
          parent: {
            uri: postModel.reply.parent.uri || ''
          }
        } : undefined,
        tags: extractTags(postModel.facets),
        mentions: extractMentions(postModel.facets)
      };

      if (!hoseData.text) {
        return {};
      }

      return hoseData;
    } catch (err) {
      console.error('Error extracting post data:', err);
      return {};
    }

  } catch (error) {
    console.error('Error processing event:', error);
    return {};  // Return empty object for consistency
  }
}

export { parseAtProtoEvent }

/**
 * ==============My parser implementation END==================
 */