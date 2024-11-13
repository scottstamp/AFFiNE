import { Loading } from '@affine/component';
import { type PDF, PDFService, PDFStatus } from '@affine/core/modules/pdf';
import type { AttachmentBlockModel } from '@blocksuite/affine/blocks';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect, useState } from 'react';

import { PDFViewerInner } from './pdf-viewer-inner';

function PDFViewerStatus({ pdf, ...props }: PDFViewerProps & { pdf: PDF }) {
  const state = useLiveData(pdf.state$);

  if (state?.status !== PDFStatus.Opened) {
    return <PDFLoading />;
  }

  return <PDFViewerInner {...props} pdf={pdf} state={state} />;
}

export interface PDFViewerProps {
  model: AttachmentBlockModel;
  name: string;
  ext: string;
  size: string;
}

export function PDFViewer({ model, ...props }: PDFViewerProps) {
  const pdfService = useService(PDFService);
  const [pdf, setPdf] = useState<PDF | null>(null);

  useEffect(() => {
    const { pdf, release } = pdfService.get(model);
    setPdf(pdf);

    return () => {
      release();
    };
  }, [model, pdfService, setPdf]);

  if (!pdf) {
    return <PDFLoading />;
  }

  return <PDFViewerStatus {...props} model={model} pdf={pdf} />;
}

const PDFLoading = () => (
  <div style={{ margin: 'auto' }}>
    <Loading />
  </div>
);
