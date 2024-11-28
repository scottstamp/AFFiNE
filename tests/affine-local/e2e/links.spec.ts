import { test } from '@affine-test/kit/playwright';
import {
  pasteByKeyboard,
  writeTextToClipboard,
} from '@affine-test/kit/utils/keyboard';
import { coreUrl, openHomePage } from '@affine-test/kit/utils/load-page';
import {
  clickNewPageButton,
  createLinkedPage,
  getBlockSuiteEditorTitle,
  waitForEmptyEditor,
} from '@affine-test/kit/utils/page-logic';
import { expect, type Locator } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await openHomePage(page);
  await clickNewPageButton(page);
  await waitForEmptyEditor(page);
});

async function notClickable(locator: Locator) {
  await expect(locator).toHaveAttribute('disabled', '');
}

async function clickable(locator: Locator) {
  await expect(locator).not.toHaveAttribute('disabled', '');
}

test('not allowed to switch to embed view when linking to the same document', async ({
  page,
}) => {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  const url0 = new URL(page.url());

  await writeTextToClipboard(page, url0.toString());
  await pasteByKeyboard(page);

  // Inline
  await page.locator('affine-reference').hover();
  await page.getByLabel('Switch view').click();

  const linkToInlineBtn = page.getByTestId('link-to-inline');
  const linkToCardBtn = page.getByTestId('link-to-card');
  const linkToEmbedBtn = page.getByTestId('link-to-embed');

  await notClickable(linkToInlineBtn);
  await clickable(linkToCardBtn);
  await notClickable(linkToEmbedBtn);

  // Switches to card view
  await linkToCardBtn.click();

  // Card
  await page.locator('affine-embed-linked-doc-block').dblclick();

  const peekViewModel = page.getByTestId('peek-view-modal');
  await expect(peekViewModel).toBeVisible();
  await expect(peekViewModel.locator('page-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(peekViewModel).not.toBeVisible();

  await page.locator('affine-embed-linked-doc-block').click();
  await page.getByLabel('Switch view').click();

  await clickable(linkToInlineBtn);
  await notClickable(linkToCardBtn);
  await notClickable(linkToEmbedBtn);
});

test('not allowed to switch to embed view when linking to block', async ({
  page,
}) => {
  await page.keyboard.press('Enter');
  await createLinkedPage(page, 'Test Page');

  await page.locator('affine-reference').hover();
  await page.getByLabel('Switch view').click();

  const linkToInlineBtn = page.getByTestId('link-to-inline');
  const linkToCardBtn = page.getByTestId('link-to-card');
  const linkToEmbedBtn = page.getByTestId('link-to-embed');

  await notClickable(linkToInlineBtn);
  await clickable(linkToCardBtn);
  await clickable(linkToEmbedBtn);

  // Switches to card view
  await linkToCardBtn.click();

  // Card
  await page.locator('affine-embed-linked-doc-block').dblclick();

  const peekViewModel = page.getByTestId('peek-view-modal');
  await expect(peekViewModel).toBeVisible();
  await expect(peekViewModel.locator('page-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(peekViewModel).not.toBeVisible();

  await page.locator('affine-embed-linked-doc-block').click();

  await page.locator('affine-embed-card-toolbar').getByLabel('More').click();
  await page.getByLabel('Copy link to block').click();

  await page.keyboard.press('Enter');
  await pasteByKeyboard(page);

  const href0 = await page
    .locator('affine-reference')
    .locator('a')
    .getAttribute('href');

  await page.locator('affine-reference').hover();
  await page.getByLabel('Switch view').click();

  await notClickable(linkToInlineBtn);
  await clickable(linkToCardBtn);
  await notClickable(linkToEmbedBtn);

  // Switches to card view
  await linkToCardBtn.click();

  await page.locator('affine-embed-linked-doc-block').nth(1).dblclick();

  await expect(peekViewModel).toBeVisible();
  await expect(peekViewModel.locator('page-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(peekViewModel).not.toBeVisible();

  await page.locator('affine-embed-linked-doc-block').nth(1).click();
  await page.getByLabel('Switch view').click();

  await clickable(linkToInlineBtn);
  await notClickable(linkToCardBtn);
  await notClickable(linkToEmbedBtn);

  // Switches to inline view
  await linkToInlineBtn.click();

  const href1 = await page
    .locator('affine-reference')
    .locator('a')
    .getAttribute('href');

  expect(href0).not.toBeNull();
  expect(href1).not.toBeNull();

  const url0 = new URL(href0!, coreUrl);
  const url1 = new URL(href1!, coreUrl);

  url0.searchParams.delete('refreshKey');
  url1.searchParams.delete('refreshKey');
  expect(url0.toJSON()).toStrictEqual(url1.toJSON());
});

test('allow switching to embed view when linking to the other document without mode', async ({
  page,
}) => {
  await page.keyboard.press('Enter');
  await createLinkedPage(page, 'Test Page');

  // Inline
  await page.locator('affine-reference').hover();
  await page.getByLabel('Switch view').click();

  const linkToInlineBtn = page.getByTestId('link-to-inline');
  const linkToCardBtn = page.getByTestId('link-to-card');
  const linkToEmbedBtn = page.getByTestId('link-to-embed');

  await notClickable(linkToInlineBtn);
  await clickable(linkToCardBtn);
  await clickable(linkToEmbedBtn);

  // Switches to card view
  await linkToCardBtn.click();

  // Card
  await page.locator('affine-embed-linked-doc-block').click();
  await page.getByLabel('Switch view').click();

  await clickable(linkToInlineBtn);
  await notClickable(linkToCardBtn);
  await clickable(linkToEmbedBtn);

  // Switches to embed view
  await linkToEmbedBtn.click();

  // Embed
  await page.locator('affine-embed-synced-doc-block').click();
  await page.waitForTimeout(300);
  await page.locator('affine-embed-synced-doc-block').click();
  await page.getByLabel('Switch view').click();

  await clickable(linkToInlineBtn);
  await clickable(linkToCardBtn);
  await notClickable(linkToEmbedBtn);

  // Closes
  await page.getByLabel('Switch view').click();
  await expect(
    page.locator('.affine-embed-synced-doc-container.page')
  ).toBeVisible();

  // Opens in peek view
  await page.locator('affine-embed-synced-doc-block').dblclick();

  const peekViewModel = page.getByTestId('peek-view-modal');
  await expect(peekViewModel).toBeVisible();
  await expect(peekViewModel.locator('page-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(peekViewModel).not.toBeVisible();
  await page.waitForTimeout(300);

  await page.locator('affine-embed-synced-doc-block').click();
  await page.getByLabel('Switch view').click();

  await clickable(linkToInlineBtn);
  await clickable(linkToCardBtn);
  await notClickable(linkToEmbedBtn);

  // Switches to card view
  await linkToCardBtn.click();

  await page.locator('affine-embed-linked-doc-block').click();
  await page.waitForTimeout(300);
  await page.locator('affine-embed-linked-doc-block').click();
  await page.getByLabel('Switch view').click();

  await clickable(linkToInlineBtn);
  await notClickable(linkToCardBtn);
  await clickable(linkToEmbedBtn);

  // Switches to inline view
  await linkToInlineBtn.click();

  await expect(page.locator('affine-reference')).toBeVisible();
});

test('allow switching to embed view when linking to the other document with mode', async ({
  page,
}) => {
  await page.keyboard.press('Enter');
  await createLinkedPage(page, 'Test Page');

  const url = new URL(page.url());
  url.searchParams.append('mode', 'edgeless');

  await page.locator('affine-reference').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');

  await writeTextToClipboard(page, url.toString());
  await pasteByKeyboard(page);

  // Inline
  await page.locator('affine-reference').hover();
  await page.getByLabel('Switch view').click();

  const linkToInlineBtn = page.getByTestId('link-to-inline');
  const linkToCardBtn = page.getByTestId('link-to-card');
  const linkToEmbedBtn = page.getByTestId('link-to-embed');

  await notClickable(linkToInlineBtn);
  await clickable(linkToCardBtn);
  await clickable(linkToEmbedBtn);

  // Switches to card view
  await linkToCardBtn.click();

  // Card
  await page.locator('affine-embed-linked-doc-block').click();
  await page.getByLabel('Switch view').click();

  await clickable(linkToInlineBtn);
  await notClickable(linkToCardBtn);
  await clickable(linkToEmbedBtn);

  // Switches to embed view
  await linkToEmbedBtn.click();

  // Embed
  await page.locator('affine-embed-synced-doc-block').click();
  await page.waitForTimeout(300);
  await page.locator('affine-embed-synced-doc-block').click();
  await page.getByLabel('Switch view').click();

  await clickable(linkToInlineBtn);
  await clickable(linkToCardBtn);
  await notClickable(linkToEmbedBtn);

  // Closes
  await page.getByLabel('Switch view').click();
  await expect(
    page.locator('.affine-embed-synced-doc-container.edgeless')
  ).toBeVisible();

  // Opens in peek view
  await page.locator('affine-embed-synced-doc-block').dblclick();

  const peekViewModel = page.getByTestId('peek-view-modal');
  await expect(peekViewModel).toBeVisible();
  await expect(peekViewModel.locator('edgeless-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(peekViewModel).not.toBeVisible();
  await page.waitForTimeout(300);

  await page.locator('affine-embed-synced-doc-block').click();
  await page.getByLabel('Switch view').click();

  await clickable(linkToInlineBtn);
  await clickable(linkToCardBtn);
  await notClickable(linkToEmbedBtn);

  // Switches to card view
  await linkToCardBtn.click();

  await page.locator('affine-embed-linked-doc-block').click();
  await page.getByLabel('Switch view').click();

  await clickable(linkToInlineBtn);
  await notClickable(linkToCardBtn);
  await clickable(linkToEmbedBtn);

  // Switches to inline view
  await linkToInlineBtn.click();

  await page.locator('affine-reference').click();

  // Checks the url
  const url2 = new URL(page.url());
  url2.searchParams.delete('refreshKey');
  expect(url.toJSON()).toStrictEqual(url2.toJSON());
});

test('@ popover should show today menu item', async ({ page }) => {
  await page.keyboard.press('Enter');
  await waitForEmptyEditor(page);
  await page.keyboard.press('@');
  await expect(page.locator('.linked-doc-popover')).toBeVisible();
  const todayMenuItem = page.locator('.linked-doc-popover').getByText('Today');
  await expect(todayMenuItem).toBeVisible();

  const textContent = await todayMenuItem.locator('span').textContent();
  await todayMenuItem.click();
  const date = textContent?.trim();

  // a affine-reference should be created with name date
  await expect(
    page.locator('affine-reference:has-text("' + date + '")')
  ).toBeVisible();
});

test('@ popover with input=tmr', async ({ page }) => {
  await page.keyboard.press('Enter');
  await waitForEmptyEditor(page);
  await page.keyboard.press('@');
  await page.keyboard.type('tmr');
  await expect(page.locator('.linked-doc-popover')).toBeVisible();
  const tomorrowMenuItem = page
    .locator('.linked-doc-popover')
    .getByText('Tomorrow');
  await expect(tomorrowMenuItem).toBeVisible();

  const textContent = await tomorrowMenuItem.locator('span').textContent();
  await tomorrowMenuItem.click();

  // a affine-reference should be created with name date
  await expect(
    page.locator('affine-reference:has-text("' + textContent + '")')
  ).toBeVisible();
});

test('@ popover with input=dec should create a reference with a December date', async ({
  page,
}) => {
  await page.keyboard.press('Enter');
  await waitForEmptyEditor(page);
  await page.keyboard.press('@');
  await page.keyboard.type('dc');

  const decemberMenuItem = page.locator(
    '.linked-doc-popover icon-button:has-text("Dec")'
  );
  await expect(decemberMenuItem).toBeVisible();

  const textContent = await decemberMenuItem
    .locator('.text-container')
    .textContent();
  await decemberMenuItem.click();

  // a affine-reference should be created with name date
  await expect(
    page.locator('affine-reference:has-text("' + textContent + '")')
  ).toBeVisible();
});

test('@ popover with click "select a specific date" should show a date picker', async ({
  page,
}) => {
  await page.keyboard.press('Enter');
  await waitForEmptyEditor(page);
  await page.keyboard.press('@');

  const todayMenuItem = page.locator('.linked-doc-popover').getByText('Today');
  await expect(todayMenuItem).toBeVisible();

  const textContent = await todayMenuItem.locator('span').textContent();
  const date = textContent?.trim();

  await page.locator('icon-button:has-text("Select a specific date")').click();
  await expect(
    page.locator('[data-is-date-cell][data-is-today=true]')
  ).toBeVisible();
  await page.locator('[data-is-date-cell][data-is-today=true]').click();

  // a affine-reference should be created with name date
  await expect(
    page.locator('affine-reference:has-text("' + date + '")')
  ).toBeVisible();
});

test('linked doc should show markdown preview in the backlink section', async ({
  page,
}) => {
  await waitForEmptyEditor(page);
  await page.keyboard.type('source page');
  await page.keyboard.press('Enter');

  await page.keyboard.type('some inline content');
  await page.keyboard.press('Enter');

  await createLinkedPage(page, 'Test Page');
  await page.locator('affine-reference:has-text("Test Page")').click();

  await expect(getBlockSuiteEditorTitle(page)).toHaveText('Test Page');
  await page
    .getByRole('button', {
      name: 'Show',
    })
    .click();

  await page.getByRole('button', { name: 'source page' }).click();

  await expect(page.locator('text-renderer')).toContainText(
    'some inline content'
  );
  await expect(page.locator('text-renderer')).toContainText('Test Page');
});
