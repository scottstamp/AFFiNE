import { IconButton, SafeArea, useIsInsideModal } from '@affine/component';
import { ArrowLeftSmallIcon, CloseIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import clsx from 'clsx';
import {
  forwardRef,
  type HtmlHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
} from 'react';

import { NavigationGestureService } from '../../modules/navigation-gesture';
import * as styles from './styles.css';

export interface PageHeaderProps
  extends Omit<HtmlHTMLAttributes<HTMLHeadElement>, 'prefix'> {
  /**
   * whether to show back button
   */
  back?: boolean;
  /**
   * Override back button action
   */
  backAction?: () => void;

  /**
   * prefix content, shown after back button(if exists)
   */
  prefix?: ReactNode;

  /**
   * suffix content
   */
  suffix?: ReactNode;

  /**
   * Weather to center the content
   * @default true
   */
  centerContent?: boolean;

  prefixClassName?: string;
  prefixStyle?: React.CSSProperties;
  suffixClassName?: string;
  suffixStyle?: React.CSSProperties;

  /**
   * Custom bottom content
   */
  bottom?: ReactNode;
  /**
   * Bottom Spacer height
   */
  bottomSpacer?: number;
}
export const PageHeader = forwardRef<HTMLDivElement, PageHeaderProps>(
  function PageHeader(
    {
      back,
      backAction,
      prefix,
      suffix,
      children,
      className,
      centerContent = true,
      prefixClassName,
      prefixStyle,
      suffixClassName,
      suffixStyle,
      bottom,
      bottomSpacer,
      ...attrs
    },
    ref
  ) {
    const navigationGesture = useService(NavigationGestureService);
    const isInsideModal = useIsInsideModal();

    useEffect(() => {
      if (isInsideModal) return;

      const prev = navigationGesture.enabled$.value;
      navigationGesture.setEnabled(!!back);

      return () => {
        navigationGesture.setEnabled(prev);
      };
    }, [back, isInsideModal, navigationGesture]);

    const handleRouteBack = useCallback(() => {
      backAction ? backAction() : history.back();
    }, [backAction]);

    return (
      <>
        <SafeArea
          top
          ref={ref}
          className={clsx(styles.root, className)}
          data-testid="mobile-page-header"
          {...attrs}
        >
          <header className={styles.inner}>
            <section
              className={clsx(styles.prefix, prefixClassName)}
              style={prefixStyle}
            >
              {back ? (
                <IconButton
                  size={24}
                  style={{ padding: 10 }}
                  onClick={handleRouteBack}
                  icon={isInsideModal ? <CloseIcon /> : <ArrowLeftSmallIcon />}
                  data-testid="page-header-back"
                />
              ) : null}
              {prefix}
            </section>

            <section
              className={clsx(styles.content, { center: centerContent })}
            >
              {children}
            </section>

            <section
              className={clsx(styles.suffix, suffixClassName)}
              style={suffixStyle}
            >
              {suffix}
            </section>
          </header>
          {bottom}
        </SafeArea>

        {/* Spacer */}
        <SafeArea top>
          <div className={styles.headerSpacer} />
          {bottom ? <div style={{ height: bottomSpacer ?? 0 }} /> : null}
        </SafeArea>
      </>
    );
  }
);
