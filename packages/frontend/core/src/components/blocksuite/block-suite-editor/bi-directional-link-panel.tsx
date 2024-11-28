import { Button, createReactComponentFromLit } from '@affine/component';
import { TextRenderer } from '@affine/core/blocksuite/presets';
import {
  type Backlink,
  DocLinksService,
  type Link,
} from '@affine/core/modules/doc-link';
import { WorkbenchLink } from '@affine/core/modules/workbench';
import { useI18n } from '@affine/i18n';
import type { JobMiddleware } from '@blocksuite/affine/store';
import { ToggleExpandIcon } from '@blocksuite/icons/rc';
import * as Collapsible from '@radix-ui/react-collapsible';
import {
  getAFFiNEWorkspaceSchema,
  LiveData,
  useLiveData,
  useServices,
  WorkspaceService,
} from '@toeverything/infra';
import React, { type ReactNode, useCallback, useMemo, useState } from 'react';

import { AffinePageReference } from '../../affine/reference-link';
import * as styles from './bi-directional-link-panel.css';

const BlocksuiteTextRenderer = createReactComponentFromLit({
  react: React,
  elementClass: TextRenderer,
});

const CollapsibleSection = ({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className={styles.link}>
        {title}
        <ToggleExpandIcon
          className={styles.collapsedIcon}
          data-collapsed={!open}
        />
      </Collapsible.Trigger>
      <Collapsible.Content>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
};

export const BiDirectionalLinkPanel = () => {
  const [show, setShow] = useState(false);
  const { docLinksService, workspaceService } = useServices({
    DocLinksService,
    WorkspaceService,
  });
  const t = useI18n();

  const links = useLiveData(
    show ? docLinksService.links.links$ : new LiveData([] as Link[])
  );
  const backlinkGroups = useLiveData(
    LiveData.computed(get => {
      if (!show) {
        return [];
      }

      const links = get(docLinksService.backlinks.backlinks$);

      // group by docId
      const groupedLinks = links.reduce(
        (acc, link) => {
          acc[link.docId] = [...(acc[link.docId] || []), link];
          return acc;
        },
        {} as Record<string, Backlink[]>
      );

      return Object.entries(groupedLinks).map(([docId, links]) => ({
        docId,
        title: links[0].title, // title should be the same for all blocks
        links,
      }));
    })
  );

  const backlinkCount = useMemo(() => {
    return backlinkGroups.reduce((acc, link) => acc + link.links.length, 0);
  }, [backlinkGroups]);

  const handleClickShow = useCallback(() => {
    setShow(!show);
  }, [show]);

  const textRendererOptions = useMemo(() => {
    const docLinkBaseURLMiddleware: JobMiddleware = ({ adapterConfigs }) => {
      adapterConfigs.set(
        'docLinkBaseUrl',
        `/workspace/${workspaceService.workspace.id}`
      );
    };

    // todo: consider refactor
    // better way to overwrite the renderer
    const rootDocMetaMiddleware: JobMiddleware = ({ collection, slots }) => {
      slots.beforeImport.on(() => {
        workspaceService.workspace.docCollection.docs.forEach(doc => {
          if (doc.meta && !collection.meta.getDocMeta(doc.id)) {
            collection.meta.addDocMeta(doc.meta);
          }
        });
      });
    };

    return {
      customHeading: true,
      additionalMiddlewares: [docLinkBaseURLMiddleware, rootDocMetaMiddleware],
    };
  }, [
    workspaceService.workspace.docCollection.docs,
    workspaceService.workspace.id,
  ]);

  return (
    <div className={styles.container}>
      {!show && (
        <div className={styles.dividerContainer}>
          <div className={styles.divider}></div>
        </div>
      )}

      <div className={styles.titleLine}>
        <div className={styles.title}>Bi-Directional Links</div>
        <Button className={styles.showButton} onClick={handleClickShow}>
          {show
            ? t['com.affine.editor.bi-directional-link-panel.hide']()
            : t['com.affine.editor.bi-directional-link-panel.show']()}
        </Button>
      </div>

      {show && (
        <>
          <div className={styles.dividerContainer}>
            <div className={styles.divider}></div>
          </div>
          <div className={styles.linksContainer}>
            <div className={styles.linksTitles}>
              {t['com.affine.page-properties.backlinks']()} · {backlinkCount}
            </div>
            {backlinkGroups.map(linkGroup => (
              <CollapsibleSection
                key={linkGroup.docId}
                title={<AffinePageReference pageId={linkGroup.docId} />}
              >
                <div className={styles.linkPreviewContainer}>
                  {linkGroup.links.map(link => {
                    if (!link.markdownPreview) {
                      return null;
                    }
                    const to = {
                      pathname: '/' + linkGroup.docId,
                      search: `?blockIds=${link.blockId}`,
                      hash: '',
                    };
                    return (
                      <WorkbenchLink
                        to={to}
                        key={link.blockId}
                        className={styles.linkPreview}
                      >
                        <BlocksuiteTextRenderer
                          className={styles.linkPreviewRenderer}
                          answer={link.markdownPreview}
                          schema={getAFFiNEWorkspaceSchema()}
                          options={textRendererOptions}
                        />
                      </WorkbenchLink>
                    );
                  })}
                </div>
              </CollapsibleSection>
            ))}
          </div>
          <div className={styles.linksContainer}>
            <div className={styles.linksTitles}>
              {t['com.affine.page-properties.outgoing-links']()} ·{' '}
              {links.length}
            </div>
            {links.map((link, i) => (
              <div
                key={`${link.docId}-${link.params?.toString()}-${i}`}
                className={styles.link}
              >
                <AffinePageReference pageId={link.docId} params={link.params} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
