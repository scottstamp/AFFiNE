import { Scrollable } from '@affine/component';
import { PageHeader } from '@affine/core/mobile/components';
import anime from 'animejs';
import {
  createContext,
  type PropsWithChildren,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';

import { SwipeHelper } from '../../pages/workspace/detail/journal-date-picker/swipe-helper';
import * as styles from './swipe-dialog.css';

export interface SwipeDialogProps extends PropsWithChildren {
  title?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const overlayOpacityRange = [0, 0.1];

const animate = (
  overlay: HTMLDivElement,
  dialog: HTMLDivElement,
  prev: HTMLElement | null,
  deltaX: number
) => {
  const limitedDeltaX = Math.min(overlay.clientWidth, Math.max(0, deltaX));
  const percent = limitedDeltaX / overlay.clientWidth;
  const opacity =
    overlayOpacityRange[1] -
    (overlayOpacityRange[1] - overlayOpacityRange[0]) * percent;
  overlay.style.background = `rgba(0, 0, 0, ${opacity})`;
  dialog.style.transform = `translateX(${limitedDeltaX}px)`;

  const prevEl = prev ?? document.querySelector('#app');
  if (prevEl) {
    const range = [-80, 0];
    const offset = range[0] + (range[1] - range[0]) * percent;
    prevEl.style.transform = `translateX(${offset}px)`;
  }
};
const reset = (
  overlay: HTMLDivElement,
  dialog: HTMLDivElement,
  prev: HTMLElement | null
) => {
  overlay && (overlay.style.background = 'transparent');
  dialog && (dialog.style.transform = 'unset');
  const prevEl = prev ?? document.querySelector('#app');
  if (prevEl) {
    prevEl.style.transform = 'unset';
  }
};

const getAnimeProxy = (
  overlay: HTMLDivElement,
  dialog: HTMLDivElement,
  prev: HTMLElement | null,
  init: number
) => {
  return new Proxy(
    { deltaX: init },
    {
      set(target, key, value) {
        if (key === 'deltaX') {
          target.deltaX = value;
          animate(overlay, dialog, prev, value);
          return true;
        }
        return false;
      },
    }
  );
};

const cancel = (
  overlay: HTMLDivElement,
  dialog: HTMLDivElement,
  prev: HTMLElement | null,
  deltaX: number,
  complete?: () => void
) => {
  anime({
    targets: getAnimeProxy(
      overlay,
      dialog,
      prev,
      Math.min(overlay.clientWidth, Math.max(0, deltaX))
    ),
    deltaX: 0,
    easing: 'easeInOutSine',
    duration: 230,
    complete: () => {
      complete?.();
      setTimeout(() => {
        reset(overlay, dialog, prev);
      }, 0);
    },
  });
};

const close = (
  overlay: HTMLDivElement,
  dialog: HTMLDivElement,
  prev: HTMLElement | null,
  deltaX: number,
  complete?: () => void
) => {
  anime({
    targets: getAnimeProxy(
      overlay,
      dialog,
      prev,
      Math.min(overlay.clientWidth, Math.max(0, deltaX))
    ),
    deltaX: overlay.clientWidth,
    easing: 'easeInOutSine',
    duration: 230,
    complete: () => {
      complete?.();
      setTimeout(() => {
        reset(overlay, dialog, prev);
      }, 0);
    },
  });
};

const SwipeDialogContext = createContext<{
  stack: Array<RefObject<HTMLElement>>;
}>({
  stack: [],
});

export const SwipeDialog = ({
  title,
  children,
  open,
  onOpenChange,
}: SwipeDialogProps) => {
  const swiperTriggerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { stack } = useContext(SwipeDialogContext);
  const prev = stack[stack.length - 1]?.current;

  const handleClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  const animateClose = useCallback(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (overlay && dialog) {
      close(overlay, dialog, prev, 0, handleClose);
    } else {
      handleClose();
    }
  }, [handleClose, prev]);

  useEffect(() => {
    if (!open) return;
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    const swipeBackTrigger = swiperTriggerRef.current;
    if (!overlay || !dialog || !swipeBackTrigger) return;

    const swipeHelper = new SwipeHelper();
    return swipeHelper.init(swipeBackTrigger, {
      preventScroll: true,
      onSwipeStart: () => {},
      onSwipe({ deltaX }) {
        animate(overlay, dialog, prev, deltaX);
      },
      onSwipeEnd: ({ deltaX }) => {
        const shouldClose = deltaX > overlay.clientWidth * 0.2;
        if (shouldClose) {
          close(overlay, dialog, prev, deltaX, handleClose);
        } else {
          cancel(overlay, dialog, prev, deltaX);
        }
      },
    });
  }, [handleClose, open, prev]);

  useEffect(() => {
    if (!open) return;
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (overlay && dialog) {
      cancel(overlay, dialog, prev, overlay.clientWidth);
    }
  }, [open, prev]);

  if (!open) return null;

  return (
    <SwipeDialogContext.Provider value={{ stack: [...stack, dialogRef] }}>
      {createPortal(
        <div className={styles.root}>
          <div className={styles.overlay} ref={overlayRef} />
          <div role="dialog" className={styles.dialog} ref={dialogRef}>
            <div className={styles.content}>
              <PageHeader
                back
                backAction={animateClose}
                className={styles.header}
              >
                <span className={styles.dialogTitle}>{title}</span>
              </PageHeader>

              <Scrollable.Root className={styles.scrollArea}>
                <Scrollable.Viewport>{children}</Scrollable.Viewport>
                <Scrollable.Scrollbar orientation="vertical" />
              </Scrollable.Root>
            </div>
            <div ref={swiperTriggerRef} className={styles.swipeBackTrigger} />
          </div>
        </div>,
        document.body
      )}
    </SwipeDialogContext.Provider>
  );
};
