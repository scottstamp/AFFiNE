import { useThemeColorV2 } from '@affine/component';
import { PageDetailSkeleton } from '@affine/component/page-detail-skeleton';
import { AffineErrorBoundary } from '@affine/core/components/affine/affine-error-boundary';
import { useRegisterBlocksuiteEditorCommands } from '@affine/core/components/hooks/affine/use-register-blocksuite-editor-commands';
import { useActiveBlocksuiteEditor } from '@affine/core/components/hooks/use-block-suite-editor';
import { useDocMetaHelper } from '@affine/core/components/hooks/use-block-suite-page-meta';
import { usePageDocumentTitle } from '@affine/core/components/hooks/use-global-state';
import { useJournalRouteHelper } from '@affine/core/components/hooks/use-journal';
import { useNavigateHelper } from '@affine/core/components/hooks/use-navigate-helper';
import { PageDetailEditor } from '@affine/core/components/page-detail-editor';
import { DetailPageWrapper } from '@affine/core/desktop/pages/workspace/detail-page/detail-page-wrapper';
import { PageHeader } from '@affine/core/mobile/components';
import { EditorService } from '@affine/core/modules/editor';
import { JournalService } from '@affine/core/modules/journal';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { ViewService } from '@affine/core/modules/workbench/services/view';
import { i18nTime } from '@affine/i18n';
import {
  BookmarkBlockService,
  customImageProxyMiddleware,
  EmbedGithubBlockService,
  EmbedLoomBlockService,
  EmbedYoutubeBlockService,
  ImageBlockService,
  RefNodeSlotsProvider,
} from '@blocksuite/affine/blocks';
import { DisposableGroup } from '@blocksuite/affine/global/utils';
import { type AffineEditorContainer } from '@blocksuite/affine/presets';
import {
  DocService,
  FeatureFlagService,
  FrameworkScope,
  GlobalContextService,
  useLiveData,
  useService,
  useServices,
  WorkspaceService,
} from '@toeverything/infra';
import { bodyEmphasized } from '@toeverything/theme/typography';
import { cssVarV2 } from '@toeverything/theme/v2';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

import { AppTabs } from '../../../components';
import { JournalDatePicker } from './journal-date-picker';
import * as styles from './mobile-detail-page.css';
import { PageHeaderMenuButton } from './page-header-more-button';
import { PageHeaderShareButton } from './page-header-share-button';

const DetailPageImpl = () => {
  const {
    editorService,
    docService,
    workspaceService,
    globalContextService,
    featureFlagService,
  } = useServices({
    WorkbenchService,
    ViewService,
    EditorService,
    DocService,
    WorkspaceService,
    GlobalContextService,
    FeatureFlagService,
  });
  const editor = editorService.editor;
  const workspace = workspaceService.workspace;
  const docCollection = workspace.docCollection;
  const globalContext = globalContextService.globalContext;
  const doc = docService.doc;

  const mode = useLiveData(editor.mode$);

  const isInTrash = useLiveData(doc.meta$.map(meta => meta.trash));
  const { openPage, jumpToPageBlock } = useNavigateHelper();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  const editorContainer = useLiveData(editor.editorContainer$);

  const enableKeyboardToolbar =
    featureFlagService.flags.enable_mobile_keyboard_toolbar.value;
  const { setDocReadonly } = useDocMetaHelper();

  // TODO(@eyhn): remove jotai here
  const [_, setActiveBlockSuiteEditor] = useActiveBlocksuiteEditor();

  useEffect(() => {
    setActiveBlockSuiteEditor(editorContainer);
  }, [editorContainer, setActiveBlockSuiteEditor]);

  useEffect(() => {
    globalContext.docId.set(doc.id);
    globalContext.isDoc.set(true);

    return () => {
      globalContext.docId.set(null);
      globalContext.isDoc.set(false);
    };
  }, [doc, globalContext]);

  useEffect(() => {
    globalContext.docMode.set(mode);

    return () => {
      globalContext.docMode.set(null);
    };
  }, [doc, globalContext, mode]);

  useEffect(() => {
    if (!enableKeyboardToolbar) setDocReadonly(doc.id, true);
  }, [enableKeyboardToolbar, doc.id, setDocReadonly]);

  useEffect(() => {
    globalContext.isTrashDoc.set(!!isInTrash);

    return () => {
      globalContext.isTrashDoc.set(null);
    };
  }, [globalContext, isInTrash]);

  useRegisterBlocksuiteEditorCommands(editor);
  const title = useLiveData(doc.title$);
  usePageDocumentTitle(title);

  const onLoad = useCallback(
    (editorContainer: AffineEditorContainer) => {
      // blocksuite editor host
      const editorHost = editorContainer.host;

      // provide image proxy endpoint to blocksuite
      editorHost?.std.clipboard.use(
        customImageProxyMiddleware(BUILD_CONFIG.imageProxyUrl)
      );
      ImageBlockService.setImageProxyURL(BUILD_CONFIG.imageProxyUrl);

      // provide link preview endpoint to blocksuite
      BookmarkBlockService.setLinkPreviewEndpoint(BUILD_CONFIG.linkPreviewUrl);
      EmbedGithubBlockService.setLinkPreviewEndpoint(
        BUILD_CONFIG.linkPreviewUrl
      );
      EmbedYoutubeBlockService.setLinkPreviewEndpoint(
        BUILD_CONFIG.linkPreviewUrl
      );
      EmbedLoomBlockService.setLinkPreviewEndpoint(BUILD_CONFIG.linkPreviewUrl);

      // provide page mode and updated date to blocksuite
      const refNodeService = editorHost?.std.getOptional(RefNodeSlotsProvider);
      const disposable = new DisposableGroup();
      if (refNodeService) {
        disposable.add(
          refNodeService.docLinkClicked.on(({ pageId, params }) => {
            if (params) {
              const { mode, blockIds, elementIds } = params;
              return jumpToPageBlock(
                docCollection.id,
                pageId,
                mode,
                blockIds,
                elementIds
              );
            }

            return openPage(docCollection.id, pageId);
          })
        );
      }

      editor.bindEditorContainer(
        editorContainer,
        null,
        scrollViewportRef.current
      );

      return () => {
        disposable.dispose();
      };
    },
    [docCollection.id, editor, jumpToPageBlock, openPage]
  );

  return (
    <FrameworkScope scope={editor.scope}>
      <div className={styles.mainContainer}>
        <div
          data-mode={mode}
          ref={scrollViewportRef}
          className={clsx(
            'affine-page-viewport',
            styles.affineDocViewport,
            styles.editorContainer
          )}
        >
          {/* Add a key to force rerender when page changed, to avoid error boundary persisting. */}
          <AffineErrorBoundary key={doc.id}>
            <PageDetailEditor onLoad={onLoad} />
          </AffineErrorBoundary>
        </div>
      </div>
    </FrameworkScope>
  );
};

const getSkeleton = (back: boolean) => (
  <>
    <PageHeader back={back} className={styles.header} />
    <PageDetailSkeleton />
  </>
);
const getNotFound = (back: boolean) => (
  <>
    <PageHeader back={back} className={styles.header} />
    Page Not Found (TODO)
  </>
);
const skeleton = getSkeleton(false);
const skeletonWithBack = getSkeleton(true);
const notFound = getNotFound(false);
const notFoundWithBack = getNotFound(true);

const MobileDetailPage = ({
  pageId,
  date,
}: {
  pageId: string;
  date?: string;
}) => {
  const journalService = useService(JournalService);
  const { openJournal } = useJournalRouteHelper();

  const allJournalDates = useLiveData(journalService.allJournalDates$);

  const handleDateChange = useCallback(
    (date: string) => {
      openJournal(date);
    },
    [openJournal]
  );
  return (
    <div className={styles.root}>
      <DetailPageWrapper
        skeleton={date ? skeleton : skeletonWithBack}
        notFound={date ? notFound : notFoundWithBack}
        pageId={pageId}
      >
        <PageHeader
          back={!date}
          className={styles.header}
          suffix={
            <>
              <PageHeaderShareButton />
              <PageHeaderMenuButton />
            </>
          }
          bottom={
            date ? (
              <JournalDatePicker
                date={date}
                onChange={handleDateChange}
                withDotDates={allJournalDates}
                className={styles.journalDatePicker}
              />
            ) : null
          }
          bottomSpacer={94}
        >
          {date ? (
            <span className={bodyEmphasized}>
              {i18nTime(dayjs(date), { absolute: { accuracy: 'month' } })}
            </span>
          ) : null}
        </PageHeader>
        <DetailPageImpl />
        {date ? (
          <AppTabs background={cssVarV2('layer/background/primary')} />
        ) : null}
      </DetailPageWrapper>
    </div>
  );
};

export const Component = () => {
  useThemeColorV2('layer/background/primary');
  const journalService = useService(JournalService);
  const params = useParams();
  const pageId = params.pageId;
  const journalDate = useLiveData(journalService.journalDate$(pageId ?? ''));

  if (!pageId) {
    return null;
  }

  return <MobileDetailPage pageId={pageId} date={journalDate} />;
};
