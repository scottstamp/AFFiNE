import {
  type AffineTextAttributes,
  MarkdownAdapter,
} from '@blocksuite/affine/blocks';
import {
  createYProxy,
  DocCollection,
  type DraftModel,
  Job,
  type JobMiddleware,
  type YBlock,
} from '@blocksuite/affine/store';
import type { DeltaInsert } from '@blocksuite/inline';
import { Document, getAFFiNEWorkspaceSchema } from '@toeverything/infra';
import { toHexString } from 'lib0/buffer.js';
import { digest as lib0Digest } from 'lib0/hash/sha256';
import { difference, uniq } from 'lodash-es';
import {
  applyUpdate,
  Array as YArray,
  Doc as YDoc,
  Map as YMap,
  Text as YText,
} from 'yjs';

import type { BlockIndexSchema, DocIndexSchema } from '../schema';
import type {
  WorkerIngoingMessage,
  WorkerInput,
  WorkerOutgoingMessage,
  WorkerOutput,
} from './types';

const blocksuiteSchema = getAFFiNEWorkspaceSchema();

const LRU_CACHE_SIZE = 5;

// lru cache for ydoc instances, last used at the end of the array
const lruCache = [] as { doc: YDoc; hash: string }[];

async function digest(data: Uint8Array) {
  if (
    globalThis.crypto &&
    globalThis.crypto.subtle &&
    typeof globalThis.crypto.subtle.digest === 'function'
  ) {
    return new Uint8Array(
      await globalThis.crypto.subtle.digest('SHA-256', data)
    );
  }
  return lib0Digest(data);
}

async function getOrCreateCachedYDoc(data: Uint8Array) {
  try {
    const hash = toHexString(await digest(data));
    const cachedIndex = lruCache.findIndex(item => item.hash === hash);
    if (cachedIndex !== -1) {
      const cached = lruCache.splice(cachedIndex, 1)[0];
      lruCache.push(cached);
      return cached.doc;
    } else {
      const doc = new YDoc();
      if (!isEmptyUpdate(data)) {
        applyUpdate(doc, data);
      }
      lruCache.push({ doc, hash });
      return doc;
    }
  } finally {
    if (lruCache.length > LRU_CACHE_SIZE) {
      lruCache.shift();
    }
  }
}

interface BlockDocumentInfo {
  docId: string;
  blockId: string;
  content?: string | string[];
  flavour: string;
  blob?: string[];
  refDocId?: string[];
  ref?: string[];
  parentFlavour?: string;
  parentBlockId?: string;
  additional?: { databaseName?: string };
  yblock: YMap<any>;
  markdownPreview?: string;
}

function generateMarkdownPreviewBuilder(yRootDoc: YDoc) {
  function yblockToDraftModal(yblock: YBlock): DraftModel | null {
    const flavour = yblock.get('sys:flavour');
    const blockSchema = blocksuiteSchema.flavourSchemaMap.get(flavour);
    if (!blockSchema) {
      return null;
    }
    const keys = Array.from(yblock.keys())
      .filter(key => key.startsWith('prop:'))
      .map(key => key.substring(5));

    const props = Object.fromEntries(
      keys.map(key => [key, createYProxy(yblock.get(`prop:${key}`))])
    );

    return {
      ...props,
      id: yblock.get('sys:id'),
      flavour,
      children: [],
      role: blockSchema.model.role,
      version: (yblock.get('sys:version') as number) ?? blockSchema.version,
      keys: Array.from(yblock.keys())
        .filter(key => key.startsWith('prop:'))
        .map(key => key.substring(5)),
    };
  }

  const titleMiddleware: JobMiddleware = ({ slots, adapterConfigs }) => {
    slots.beforeExport.on(() => {
      const pages = yRootDoc.getMap('meta').get('pages');
      if (!(pages instanceof YArray)) {
        return;
      }
      for (const meta of pages.toArray()) {
        adapterConfigs.set(
          'title:' + meta.get('id'),
          meta.get('title')?.toString() ?? 'Untitled'
        );
      }
    });
  };

  const docLinkBaseURLMiddleware: JobMiddleware = ({
    slots,
    adapterConfigs,
  }) => {
    slots.beforeExport.on(() => {
      adapterConfigs.set('docLinkBaseUrl', `/workspace/${yRootDoc.guid}/`);
    });
  };

  const markdownAdapter = new MarkdownAdapter(
    new Job({
      collection: new DocCollection({
        id: 'indexer',
        schema: blocksuiteSchema,
      }),
      middlewares: [docLinkBaseURLMiddleware, titleMiddleware],
    })
  );

  const markdownPreviewCache = new WeakMap<BlockDocumentInfo, string | null>();
  const generateMarkdownPreview = async (block: BlockDocumentInfo) => {
    if (markdownPreviewCache.has(block)) {
      return markdownPreviewCache.get(block);
    }
    const flavour = block.flavour;
    let markdown: string | null = null;
    if (
      flavour === 'affine:paragraph' ||
      flavour === 'affine:list' ||
      flavour === 'affine:code'
    ) {
      const draftModel = yblockToDraftModal(block.yblock);
      markdown =
        block.parentFlavour === 'affine:database'
          ? `database · ${block.additional?.databaseName}\n`
          : ((draftModel ? await markdownAdapter.fromBlock(draftModel) : null)
              ?.file ?? null);
    }
    if (
      flavour === 'affine:embed-linked-doc' ||
      flavour === 'affine:embed-synced-doc'
    ) {
      markdown = '🔗\n';
    }
    if (flavour === 'affine:attachment') {
      markdown = '📃\n';
    }
    if (flavour === 'affine:image') {
      markdown = '🖼️\n';
    }
    markdownPreviewCache.set(block, markdown);
    return markdown;
  };

  return generateMarkdownPreview;
}

async function crawlingDocData({
  docBuffer,
  storageDocId,
  rootDocBuffer,
}: WorkerInput & { type: 'doc' }): Promise<WorkerOutput> {
  if (isEmptyUpdate(rootDocBuffer)) {
    console.warn('[worker]: Empty root doc buffer');
    return {};
  }

  const yRootDoc = await getOrCreateCachedYDoc(rootDocBuffer);

  let docId = null;
  for (const [id, subdoc] of yRootDoc.getMap('spaces')) {
    if (subdoc instanceof YDoc && storageDocId === subdoc.guid) {
      docId = id;
      break;
    }
  }

  if (docId === null) {
    return {};
  }

  let docExists: boolean | null = null;

  (
    yRootDoc.getMap('meta').get('pages') as YArray<YMap<any>> | undefined
  )?.forEach(page => {
    if (page.get('id') === docId) {
      docExists = !(page.get('trash') ?? false);
    }
  });

  if (!docExists) {
    return {
      deletedDoc: [docId],
    };
  } else {
    if (isEmptyUpdate(docBuffer)) {
      return {
        deletedDoc: [docId],
      };
    }

    const ydoc = await getOrCreateCachedYDoc(docBuffer);
    let docTitle = '';
    let summaryLenNeeded = 1000;
    let summary = '';
    const blockDocuments: BlockDocumentInfo[] = [];

    const generateMarkdownPreview = generateMarkdownPreviewBuilder(yRootDoc);

    const blocks = ydoc.getMap<any>('blocks');

    if (blocks.size === 0) {
      return { deletedDoc: [docId] };
    }

    let rootBlockId: string | null = null;
    for (const block of blocks.values()) {
      const flavour = block.get('sys:flavour')?.toString();
      const blockId = block.get('sys:id')?.toString();
      if (flavour === 'affine:page' && blockId) {
        rootBlockId = blockId;
      }
    }

    if (!rootBlockId) {
      return { deletedDoc: [docId] };
    }

    const queue: { parent?: string; id: string }[] = [{ id: rootBlockId }];
    const visited = new Set<string>(); // avoid loop

    const pushChildren = (id: string, block: YMap<any>) => {
      const children = block.get('sys:children');
      if (children instanceof YArray && children.length) {
        for (let i = children.length - 1; i >= 0; i--) {
          const childId = children.get(i);
          if (childId && !visited.has(childId)) {
            queue.push({ parent: id, id: childId });
            visited.add(childId);
          }
        }
      }
    };

    // #region first loop - generate block base info
    while (queue.length) {
      const next = queue.pop();
      if (!next) {
        break;
      }

      const { parent: parentBlockId, id: blockId } = next;
      const block = blockId ? blocks.get(blockId) : null;
      const parentBlock = parentBlockId ? blocks.get(parentBlockId) : null;
      if (!block) {
        break;
      }

      const flavour = block.get('sys:flavour')?.toString();
      const parentFlavour = parentBlock?.get('sys:flavour')?.toString();

      pushChildren(blockId, block);

      if (flavour === 'affine:page') {
        docTitle = block.get('prop:title').toString();
        blockDocuments.push({
          docId,
          flavour,
          blockId,
          content: docTitle,
          yblock: block,
        });
      }

      if (
        flavour === 'affine:paragraph' ||
        flavour === 'affine:list' ||
        flavour === 'affine:code'
      ) {
        const text = block.get('prop:text') as YText;

        if (!text) {
          continue;
        }

        const deltas: DeltaInsert<AffineTextAttributes>[] = text.toDelta();
        const refs = uniq(
          deltas
            .flatMap(delta => {
              if (
                delta.attributes &&
                delta.attributes.reference &&
                delta.attributes.reference.pageId
              ) {
                const { pageId: refDocId, params = {} } =
                  delta.attributes.reference;
                return {
                  refDocId,
                  ref: JSON.stringify({ docId: refDocId, ...params }),
                };
              }
              return null;
            })
            .filter(ref => !!ref)
        );

        const databaseName =
          flavour === 'affine:paragraph' && parentFlavour === 'affine:database' // if block is a database row
            ? parentBlock?.get('prop:title')?.toString()
            : undefined;

        blockDocuments.push({
          docId,
          flavour,
          blockId,
          content: text.toString(),
          ...refs.reduce<{ refDocId: string[]; ref: string[] }>(
            (prev, curr) => {
              prev.refDocId.push(curr.refDocId);
              prev.ref.push(curr.ref);
              return prev;
            },
            { refDocId: [], ref: [] }
          ),
          parentFlavour,
          parentBlockId,
          additional: { databaseName },
          yblock: block,
        });

        if (summaryLenNeeded > 0) {
          summary += text.toString();
          summaryLenNeeded -= text.length;
        }
      }

      if (
        flavour === 'affine:embed-linked-doc' ||
        flavour === 'affine:embed-synced-doc'
      ) {
        const pageId = block.get('prop:pageId');
        if (typeof pageId === 'string') {
          // reference info
          const params = block.get('prop:params') ?? {};
          blockDocuments.push({
            docId,
            flavour,
            blockId,
            refDocId: [pageId],
            ref: [JSON.stringify({ docId: pageId, ...params })],
            parentFlavour,
            parentBlockId,
            yblock: block,
          });
        }
      }

      if (flavour === 'affine:attachment' || flavour === 'affine:image') {
        const blobId = block.get('prop:sourceId');
        if (typeof blobId === 'string') {
          blockDocuments.push({
            docId,
            flavour,
            blockId,
            blob: [blobId],
            parentFlavour,
            parentBlockId,
            yblock: block,
          });
        }
      }

      if (flavour === 'affine:surface') {
        const texts = [];

        const elementsObj = block.get('prop:elements');
        if (
          !(
            elementsObj instanceof YMap &&
            elementsObj.get('type') === '$blocksuite:internal:native$'
          )
        ) {
          continue;
        }
        const elements = elementsObj.get('value') as YMap<any>;
        if (!(elements instanceof YMap)) {
          continue;
        }

        for (const element of elements.values()) {
          if (!(element instanceof YMap)) {
            continue;
          }
          const text = element.get('text') as YText;
          if (!text) {
            continue;
          }

          texts.push(text.toString());
        }

        blockDocuments.push({
          docId,
          flavour,
          blockId,
          content: texts,
          parentFlavour,
          parentBlockId,
          yblock: block,
        });
      }

      if (flavour === 'affine:database') {
        const texts = [];
        const columnsObj = block.get('prop:columns');
        const databaseTitle = block.get('prop:title');
        if (databaseTitle instanceof YText) {
          texts.push(databaseTitle.toString());
        }
        if (columnsObj instanceof YArray) {
          for (const column of columnsObj) {
            if (!(column instanceof YMap)) {
              continue;
            }
            if (typeof column.get('name') === 'string') {
              texts.push(column.get('name'));
            }

            const data = column.get('data');
            if (!(data instanceof YMap)) {
              continue;
            }
            const options = data.get('options');
            if (!(options instanceof YArray)) {
              continue;
            }
            for (const option of options) {
              if (!(option instanceof YMap)) {
                continue;
              }
              const value = option.get('value');
              if (typeof value === 'string') {
                texts.push(value);
              }
            }
          }
        }

        blockDocuments.push({
          docId,
          flavour,
          blockId,
          content: texts,
          yblock: block,
        });
      }
    }
    // #endregion

    // #region second loop - generate markdown preview
    const TARGET_PREVIEW_CHARACTER = 500;
    const TARGET_PREVIOUS_BLOCK = 1;
    const TARGET_FOLLOW_BLOCK = 4;
    for (let i = 0; i < blockDocuments.length; i++) {
      const block = blockDocuments[i];
      if (block.ref?.length) {
        // only generate markdown preview for reference blocks
        let previewText = (await generateMarkdownPreview(block)) ?? '';
        let previousBlock = 0;
        let followBlock = 0;
        let previousIndex = i;
        let followIndex = i;

        while (
          !(
            (
              previewText.length > TARGET_PREVIEW_CHARACTER || // stop if preview text reaches the limit
              ((previousBlock >= TARGET_PREVIOUS_BLOCK || previousIndex < 0) &&
                (followBlock >= TARGET_FOLLOW_BLOCK ||
                  followIndex >= blockDocuments.length))
            ) // stop if no more blocks, or preview block reaches the limit
          )
        ) {
          if (previousBlock < TARGET_PREVIOUS_BLOCK) {
            previousIndex--;
            const block =
              previousIndex >= 0 ? blockDocuments.at(previousIndex) : null;
            const markdown = block
              ? await generateMarkdownPreview(block)
              : null;
            if (
              markdown &&
              !previewText.startsWith(
                markdown
              ) /* A small hack to skip blocks with the same content */
            ) {
              previewText = markdown + previewText;
              previousBlock++;
            }
          }

          if (followBlock < TARGET_FOLLOW_BLOCK) {
            followIndex++;
            const block = blockDocuments.at(followIndex);
            const markdown = block
              ? await generateMarkdownPreview(block)
              : null;
            if (
              markdown &&
              !previewText.endsWith(
                markdown
              ) /* A small hack to skip blocks with the same content */
            ) {
              previewText = previewText + markdown;
              followBlock++;
            }
          }
        }

        block.markdownPreview = previewText;
      }
    }
    // #endregion

    return {
      addedDoc: [
        {
          id: docId,
          doc: Document.from<DocIndexSchema>(docId, {
            title: docTitle,
            summary,
          }),
          blocks: blockDocuments.map(block =>
            Document.from<BlockIndexSchema>(`${docId}:${block.blockId}`, {
              docId: block.docId,
              blockId: block.blockId,
              content: block.content,
              flavour: block.flavour,
              blob: block.blob,
              refDocId: block.refDocId,
              ref: block.ref,
              parentFlavour: block.parentFlavour,
              parentBlockId: block.parentBlockId,
              additional: block.additional
                ? JSON.stringify(block.additional)
                : undefined,
              markdownPreview: block.markdownPreview,
            })
          ),
        },
      ],
    };
  }
}

async function crawlingRootDocData({
  allIndexedDocs,
  rootDocBuffer,
  reindexAll,
}: WorkerInput & {
  type: 'rootDoc';
}): Promise<WorkerOutput> {
  const ydoc = await getOrCreateCachedYDoc(rootDocBuffer);

  const docs = ydoc.getMap('meta').get('pages') as
    | YArray<YMap<any>>
    | undefined;

  if (!docs) {
    return {};
  }

  const availableDocs = [];

  for (const page of docs) {
    const docId = page.get('id');

    if (typeof docId !== 'string') {
      continue;
    }

    const inTrash = page.get('trash') ?? false;

    if (!inTrash) {
      availableDocs.push(docId);
    }
  }

  const needDelete = difference(allIndexedDocs, availableDocs);
  const needAdd = reindexAll
    ? availableDocs
    : difference(availableDocs, allIndexedDocs);

  return {
    reindexDoc: [...needAdd, ...needDelete].map(docId => ({
      docId,
      storageDocId: ydoc.getMap<YDoc>('spaces').get(docId)?.guid ?? docId,
    })),
  };
}

globalThis.onmessage = async (event: MessageEvent<WorkerIngoingMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    postMessage({ type: 'init', msgId: message.msgId });
    return;
  }
  if (message.type === 'run') {
    const { input } = message;
    try {
      let data;
      if (input.type === 'rootDoc') {
        data = await crawlingRootDocData(input);
      } else {
        data = await crawlingDocData(input);
      }

      postMessage({ type: 'done', msgId: message.msgId, output: data });
    } catch (error) {
      postMessage({
        type: 'failed',
        msgId: message.msgId,
        error: error instanceof Error ? error.message : error + '',
      });
    }
  }
};

declare function postMessage(message: WorkerOutgoingMessage): void;

function isEmptyUpdate(binary: Uint8Array) {
  return (
    binary.byteLength === 0 ||
    (binary.byteLength === 2 && binary[0] === 0 && binary[1] === 0)
  );
}
