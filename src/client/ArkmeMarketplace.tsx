import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { ArrowUpRight } from '@phosphor-icons/react/dist/icons/ArrowUpRight'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import type {
  ArkmeExtensionCatalogItem, ArkmeExtensionCatalogPage, ArkmeExtensionClassificationPage,
  ArkmeExtensionClassificationStatus, ArkmeExtensionClassificationTree,
  ArkmeExtensionInstallPreview, ArkmeExtensionInstallTaskSnapshot,
  ArkmeExtensionCompleteDeleteResult, ArkmeExtensionEnabledResult, ArkmeExtensionPreviewItem, ArkmeExtensionPublishResult, ArkmeExtensionUpdateResolution,
  ArkmeInstalledExtensionView, ArkmeSharedExtensionDetail, ArkmeExtensionAuditResult,
} from '../extensions/types.js'
import { effectiveExtensionPublisherRole } from '../extensions/publisher-role.js'
import { ARKME_EXTENSION_RUNTIME_UNAVAILABLE_MESSAGE } from '../extensions/types.js'
import type { ArkmeOpenPrivateChatResult, ArkmeSourceItem } from '../types.js'
import type { ArkmeMyExtensionItem, ArkmeMyExtensionPage } from '../extensions/owned-types.js'
import { ArkmeExtensionIcon } from './ArkmeExtensionIcon.js'
import { ArkmeExtensionAvatar } from './ArkmeExtensionAvatar.js'
import { ArkmeExtensionPreviewGallery } from './ArkmeExtensionPreviewGallery.js'
import { ArkmeExtensionPublishDialog, type ArkmeExtensionPublishFormValue } from './ArkmeExtensionPublishDialog.js'
import { ArkmeExtensionEditDialog, type ArkmeExtensionEditFormValue } from './ArkmeExtensionEditDialog.js'
import {
  applyEditedMyExtension, nextExtensionEditMutation, saveExtensionEdit, type ExtensionEditMutation,
} from './extension-edit-flow.js'
import { ArkmeExtensionReviews, extensionRatingLabel } from './ArkmeExtensionReviews.js'
import { ArkmeExtensionSourceLink } from './ArkmeExtensionShare.js'
import { ArkmeSharedExtensionDetail as SharedExtensionDetailView } from './ArkmeSharedExtensionDetail.js'
import { appendExtensionDiscoverPage, extensionTabSelection, mergeExtensionDiscoverItems } from './extension-market-model.js'
import { callArkme } from './api.js'
import { resolveExtensionSharePresentation } from './extension-share-presentation.js'
import type { ArkmeExtensionShareAction } from './extension-share-deeplink.js'
import { createArkmeSdk } from '../sdk/index.js'
import { myExtensionBadges, myExtensionPrimaryAction, myExtensionWarningText, nextExtensionPublishMutation,
  type ExtensionPublishMutation,
} from './my-extension-model.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeUi, type ArkmeWorldTarget } from './ui-controller.js'
import {
  DEFAULT_MARKETPLACE_SORT, readMarketplaceSortPreference, writeMarketplaceSortPreference,
  type MarketplaceSort,
} from './marketplace-sort-preference.js'

type Tab = 'discover' | 'installed' | 'mine' | 'updates'
const extensionSdk = createArkmeSdk()
export const ARKME_EXTENSION_BRAND_GREEN = '#8295E8'
export const ARKME_EXTENSION_PRIMARY_ACTION_BG = arkmeTheme.primaryAction
export const ARKME_EXTENSION_PRIMARY_ACTION_FG = arkmeTheme.onPrimaryAction
export const ARKME_EXTENSION_RESTART_SURFACE = arkmeTheme.menu
export const ARKME_EXTENSION_DETAIL_MODAL_MAX_WIDTH = 920
export const ARKME_EXTENSION_DETAIL_MODAL_MAX_HEIGHT = 680
export const ARKME_EXTENSION_MARKETPLACE_PAGE_SIZE = 70

export function extensionTabLoadMode(loadedTabs: ReadonlySet<string>, target: string): 'initial' | 'refresh' {
  return loadedTabs.has(target) ? 'refresh' : 'initial'
}

const colors = {
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  caption: arkmeTheme.caption,
  border: arkmeTheme.borderSoft,
  accent: arkmeTheme.accent,
  accentSoft: arkmeTheme.accentSoft,
  surface: arkmeTheme.layer2,
  subtle: arkmeTheme.subtle,
  hover: arkmeTheme.hover,
  warning: arkmeTheme.warning,
  danger: arkmeTheme.danger,
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed', zIndex: 90, inset: 0, display: 'grid', placeItems: 'center', padding: 32,
    boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(17, 24, 39, .20))',
    backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
  },
  dialog: {
    position: 'relative',
    width: 'min(860px, calc(100vw - 64px))', height: 'min(680px, calc(100vh - 64px))',
    minWidth: 0, minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
    border: `1px solid ${colors.border}`, borderRadius: 18, background: colors.surface,
    boxShadow: '0 28px 80px rgba(20, 24, 31, .22), 0 4px 18px rgba(20, 24, 31, .08)',
  },
  pageBackdrop: { width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' },
  pageDialog: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
    background: arkmeTheme.base,
  },
  detailModalBackdrop: {
    position: 'fixed', zIndex: 100, inset: 0, display: 'grid', placeItems: 'center', padding: 16,
    boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(17, 24, 39, .42))',
    backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
  },
  detailModal: {
    width: `min(${ARKME_EXTENSION_DETAIL_MODAL_MAX_WIDTH}px, calc(100vw - 32px))`,
    height: `min(${ARKME_EXTENSION_DETAIL_MODAL_MAX_HEIGHT}px, calc(100vh - 32px))`,
    minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 20,
    background: colors.surface, color: colors.text,
    boxShadow: '0 30px 90px rgba(20,24,31,.28), 0 8px 24px rgba(20,24,31,.12)',
  },
  detailModalHeader: {
    minHeight: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 10,
    padding: '0 14px 0 20px', boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`,
  },
  detailModalTitle: {
    minWidth: 0, flex: 1, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: colors.text, fontSize: 16, lineHeight: '24px', fontWeight: 650,
  },
  detailModalHeaderAction: {
    position: 'relative', width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center',
    padding: 0, border: 0, borderRadius: 9, background: 'transparent', color: colors.text, cursor: 'pointer',
  },
  detailCopyNotice: {
    position: 'absolute', zIndex: 2, top: 43, right: 0, width: 'max-content', maxWidth: 220,
    padding: '7px 10px', borderRadius: 8, background: colors.text,
    color: colors.surface, fontSize: 11, lineHeight: '16px', boxShadow: '0 8px 22px rgba(20,24,31,.18)',
  },
  detailModalBody: {
    minHeight: 0, flex: 1, overflowY: 'auto',
    padding: '22px clamp(18px, 3vw, 26px) 30px', boxSizing: 'border-box',
  },
  detailModalState: {
    minHeight: 260, display: 'grid', placeItems: 'center', padding: 30, boxSizing: 'border-box',
    color: colors.secondary, fontSize: 12, textAlign: 'center',
  },
  detailModalErrorActions: { display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14 },
  shell: {
    width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
    background: colors.surface, color: colors.text, fontFamily: 'var(--dsw-font-family, inherit)',
  },
  pageShell: { background: arkmeTheme.base },
  embeddedFrame: { width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' },
  embeddedDialog: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden',
    border: 0, borderRadius: 0, background: '#fff', boxShadow: 'none',
  },
  embeddedShell: { overflowY: 'auto', background: '#fff' },
  embeddedHeader: {
    width: 'min(980px, calc(100% - 96px))', height: 'auto', minHeight: 0, margin: '0 auto',
    padding: '38px 0 0', alignItems: 'flex-start', boxSizing: 'border-box',
  },
  embeddedHeaderCopy: { flex: 1, minWidth: 0 },
  eyebrow: { margin: '0 0 8px', color: '#858991', fontSize: 14, lineHeight: '20px' },
  embeddedTitle: { margin: 0, fontSize: 36, lineHeight: '46px', letterSpacing: '-.04em', fontWeight: 650 },
  embeddedSubtitle: { display: 'block', marginTop: 12, color: '#7d818b', fontSize: 15, lineHeight: '22px' },
  mineButton: {
    height: 38, flex: 'none', marginTop: 7, padding: '0 13px', border: '1px solid #dedfe3',
    borderRadius: 10, background: '#fff', color: '#242629', cursor: 'pointer', font: 'inherit', fontSize: 12,
  },
  search: {
    width: 'min(980px, calc(100% - 96px))', height: 46, minHeight: 46, margin: '25px auto 0',
    padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box',
    border: '1px solid #dedfe3', borderRadius: 10, color: '#858991', background: '#fff',
  },
  searchInput: { flex: 1, minWidth: 0, height: '100%', border: 0, outline: 0, background: 'transparent', font: 'inherit', fontSize: 13 },
  embeddedList: {
    width: 'min(980px, calc(100% - 96px))', margin: '0 auto', padding: '15px 0 96px',
    display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, alignContent: 'start',
  },
  header: {
    height: 58, flex: 'none', display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 20px', boxSizing: 'border-box',
  },
  iconButton: {
    width: 30, height: 30, flex: 'none', display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 8, background: 'transparent', color: colors.text, cursor: 'pointer',
  },
  headerShareButton: {
    height: 30, flex: 'none', padding: '0 11px', border: `1px solid ${colors.border}`, borderRadius: 8,
    background: 'transparent', color: colors.text, font: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  title: { flex: 1, minWidth: 0, margin: 0, fontSize: 17, lineHeight: '24px', fontWeight: 600 },
  tabs: {
    height: 40, flex: 'none', display: 'flex', alignItems: 'stretch', padding: '0 22px',
    boxSizing: 'border-box',
  },
  tab: {
    minWidth: 0, flex: 1, position: 'relative', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', gap: 4, padding: '0 2px', border: 0, outline: 0,
    background: 'transparent', color: colors.secondary, font: 'inherit', fontSize: 12,
    whiteSpace: 'nowrap', cursor: 'pointer',
  },
  activeTab: { color: colors.accent, fontWeight: 600 },
  tabLabel: {
    height: '100%', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 4px',
    boxSizing: 'border-box',
  },
  activeTabLabel: { borderBottom: `2px solid ${colors.accent}` },
  count: {
    minWidth: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 4px', boxSizing: 'border-box', borderRadius: 999, background: colors.accentSoft,
    color: colors.accent, fontSize: 9, fontWeight: 650,
  },
  list: { minHeight: 0, flex: 1, overflowY: 'auto', padding: '8px 22px 22px', boxSizing: 'border-box' },
  pageHeader: { padding: '28px 32px 16px', flex: 'none', borderBottom: `1px solid ${colors.border}` },
  marketPageHeader: {
    height: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 34, padding: '0 64px 0 32px',
    boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`,
  },
  pageTitleRow: { display: 'flex', alignItems: 'center', gap: 20 },
  pageTitle: { margin: 0, flex: 1, minWidth: 0, color: colors.text, fontSize: 26, lineHeight: '34px', fontWeight: 650 },
  marketPageTitle: { margin: 0, flex: 'none', color: colors.text, fontSize: 18, lineHeight: '26px', fontWeight: 650 },
  marketPageTabs: {
    height: '100%', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
  },
  marketPageTab: {
    minWidth: 0, height: 30, flex: 'none', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', padding: '0 12px', border: 0, borderRadius: 8, outline: 0,
    background: 'transparent', color: colors.secondary, font: 'inherit', fontSize: 12,
    whiteSpace: 'nowrap', cursor: 'pointer', transition: 'background-color .15s ease, color .15s ease',
  },
  marketPageActiveNav: { background: colors.subtle, color: colors.text, fontWeight: 600 },
  marketPageNavLabel: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  marketPageNavCount: { background: colors.hover, color: colors.caption },
  marketplaceToolbar: {
    flex: 'none', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    padding: '14px 32px', boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`,
  },
  searchBox: {
    height: 40, flex: '1 1 360px', minWidth: 220, maxWidth: 680, boxSizing: 'border-box', padding: '0 14px',
    border: `1px solid ${colors.border}`, borderRadius: 10, outline: 0,
    background: colors.subtle, color: colors.text, font: 'inherit', fontSize: 13,
  },
  discoverControls: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, minWidth: 0, marginLeft: 'auto' },
  marketplaceAuthorFilter: {
    height: 28, maxWidth: '100%', display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '0 9px', border: `1px solid ${colors.border}`, borderRadius: 999,
    background: colors.subtle, color: colors.text, fontSize: 12, lineHeight: '18px',
  },
  marketplaceAuthorFilterLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  marketplaceAuthorFilterClear: {
    width: 18, height: 18, display: 'grid', placeItems: 'center', padding: 0, border: 0,
    borderRadius: 999, background: 'transparent', color: colors.secondary, font: 'inherit', cursor: 'pointer',
  },
  marketplaceMenuRoot: { position: 'relative', flex: 'none' },
  marketplaceMenuButton: {
    height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    minWidth: 118, padding: '0 12px', border: `1px solid ${colors.border}`, borderRadius: 10,
    background: colors.surface, color: colors.text, font: 'inherit', fontSize: 12, cursor: 'pointer',
  },
  marketplaceMenu: {
    position: 'absolute', zIndex: 20, top: 46, right: 0, width: 190, maxHeight: 320,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 12,
    background: colors.surface, boxShadow: '0 12px 32px rgba(20, 24, 31, .16)',
  },
  marketplaceMenuSearchWrap: { flex: 'none', padding: 6, borderBottom: `1px solid ${colors.border}` },
  marketplaceMenuSearch: {
    width: '100%', height: 34, boxSizing: 'border-box', padding: '0 10px',
    border: `1px solid ${colors.border}`, borderRadius: 8, outline: 0,
    background: colors.subtle, color: colors.text, font: 'inherit', fontSize: 12,
  },
  marketplaceMenuList: {
    minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: 6,
  },
  marketplaceMenuOption: {
    width: '100%', minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    padding: '0 10px', border: 0, borderRadius: 8, background: 'transparent',
    color: colors.text, textAlign: 'left', font: 'inherit', fontSize: 12, cursor: 'pointer',
  },
  marketplaceMenuHint: {
    margin: '4px 4px 2px', padding: '8px 7px 4px', borderTop: `1px solid ${colors.border}`,
    color: colors.caption, fontSize: 10, lineHeight: '16px',
  },
  marketplaceMenuEmpty: {
    minHeight: 72, display: 'grid', placeItems: 'center', padding: '10px 12px', boxSizing: 'border-box',
    color: colors.caption, fontSize: 11, lineHeight: '17px', textAlign: 'center',
  },
  communityGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
    gap: 10,
    width: '100%', maxWidth: 1440, margin: '0 auto', boxSizing: 'border-box',
  },
  marketplaceLoadingMore: {
    minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    color: colors.caption, fontSize: 11,
  },
  marketplaceLoadMoreRetry: {
    minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    color: colors.caption, fontSize: 11,
  },
  marketplaceRetryButton: {
    height: 28, padding: '0 11px', border: `1px solid ${colors.border}`, borderRadius: 8,
    background: colors.surface, color: colors.text, font: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  communityCard: {
    position: 'relative', minWidth: 0, minHeight: 72, boxSizing: 'border-box',
    padding: 0, border: `1px solid ${colors.border}`, borderRadius: 10, background: colors.surface,
    color: colors.text, textAlign: 'left', transition: 'background-color .15s ease, border-color .15s ease, box-shadow .15s ease',
  },
  communityPrimary: {
    width: '100%', minWidth: 0, minHeight: 72, display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px', boxSizing: 'border-box',
    border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', font: 'inherit', cursor: 'pointer',
  },
  communityTitleRow: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  communityTitle: {
    display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 13, lineHeight: '20px', fontWeight: 600,
  },
  communityIdentityRow: {
    minWidth: 0, display: 'flex', alignItems: 'center', gap: 5, marginTop: 6,
    color: colors.secondary, fontSize: 10, lineHeight: '16px',
  },
  communityIdentityName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  communityIdentityAvatar: {
    width: 18, height: 18, flex: 'none', display: 'grid', placeItems: 'center', overflow: 'hidden',
    borderRadius: '50%', background: colors.subtle, color: colors.secondary,
  },
  lifecycleList: {
    width: '100%', maxWidth: 1440, margin: '0 auto', borderTop: `1px solid ${colors.border}`,
  },
  lifecycleRow: {
    width: '100%', minWidth: 0, minHeight: 78, display: 'flex', alignItems: 'center', gap: 14,
    padding: '14px 8px', boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`,
    background: 'transparent', color: colors.text,
  },
  lifecyclePrimary: {
    minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: 0,
    border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', font: 'inherit', cursor: 'pointer',
  },
  lifecycleCopy: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  lifecycleTitle: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: colors.text, fontSize: 14, lineHeight: '21px', fontWeight: 650,
  },
  lifecycleAuthor: {
    minWidth: 0, display: 'flex', alignItems: 'center', marginTop: 7,
    color: colors.secondary, fontSize: 11, lineHeight: '17px',
  },
  lifecycleActions: { flex: 'none', display: 'flex', alignItems: 'center', gap: 10 },
  authorButton: {
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: 0, border: 0,
    background: 'transparent', color: colors.text, font: 'inherit', fontSize: 12, cursor: 'pointer',
  },
  authorPopoverRoot: { position: 'relative', width: 'fit-content', maxWidth: '100%' },
  authorCard: {
    position: 'absolute', zIndex: 25, top: 'calc(100% + 10px)', left: 0,
    width: 'min(320px, calc(100vw - 64px))', padding: 16, boxSizing: 'border-box',
    border: `1px solid ${colors.border}`, borderRadius: 16, background: colors.surface,
    boxShadow: '0 18px 48px rgba(20,24,31,.18), 0 4px 14px rgba(20,24,31,.08)',
  },
  authorCardHeader: { position: 'relative', display: 'flex', alignItems: 'center', gap: 12, paddingRight: 30 },
  authorCardName: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: colors.text, fontSize: 16, lineHeight: '22px', fontWeight: 650,
  },
  authorCardProfileIcon: {
    position: 'absolute', top: -3, right: -3, width: 28, height: 28, display: 'grid', placeItems: 'center',
    padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: colors.caption,
    font: 'inherit', cursor: 'pointer',
  },
  authorCardWorldLink: {
    minHeight: 34, marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
    width: '100%', padding: 0, border: 0, background: 'transparent', color: colors.secondary,
    font: 'inherit', fontSize: 12, lineHeight: '18px', cursor: 'pointer',
  },
  authorCardActions: { display: 'flex', gap: 8, marginTop: 12 },
  authorCardMessageButton: {
    flex: 1, minWidth: 0, height: 40, border: 0, borderRadius: 999,
    background: ARKME_EXTENSION_PRIMARY_ACTION_BG, color: ARKME_EXTENSION_PRIMARY_ACTION_FG,
    font: 'inherit', fontSize: 13, fontWeight: 650, cursor: 'pointer',
  },
  authorCardExtensionsButton: {
    flex: 1, minWidth: 0, height: 40, border: `1px solid ${colors.border}`, borderRadius: 999,
    background: colors.surface, color: colors.text,
    font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  card: {
    width: '100%', minWidth: 0, display: 'flex', gap: 10, boxSizing: 'border-box',
    margin: 0, padding: '11px 8px', border: 0, borderBottom: `1px solid ${colors.border}`, borderRadius: 0,
    background: 'transparent', color: colors.text, textAlign: 'left',
  },
  cardGrid: {
    minHeight: 126, padding: 16, border: '1px solid #e2e3e6', borderRadius: 16,
    background: '#fff', alignItems: 'stretch', boxShadow: '0 5px 18px rgba(25,28,38,.025)',
  },
  cardButton: { cursor: 'pointer', font: 'inherit' },
  cardPrimary: {
    minWidth: 0, flex: 1, display: 'flex', gap: 10, alignItems: 'flex-start', padding: 0,
    border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', font: 'inherit', cursor: 'pointer',
  },
  installSmall: {
    height: 28, flex: 'none', alignSelf: 'center', padding: '0 12px', border: 0, borderRadius: 8,
    background: ARKME_EXTENSION_PRIMARY_ACTION_BG, color: ARKME_EXTENSION_PRIMARY_ACTION_FG,
    font: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  iconSmall: {
    height: 28, display: 'inline-flex', alignItems: 'center', flex: 'none', padding: '0 10px',
    border: `1px solid ${colors.border}`, borderRadius: 8, background: 'transparent', color: colors.secondary,
    font: 'inherit', fontSize: 11, cursor: 'pointer', boxSizing: 'border-box',
  },
  actionGroup: { flex: 'none', alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 8 },
  toggle: {
    width: 40, height: 22, flex: 'none', border: 0, borderRadius: 999, padding: 2,
    display: 'flex', alignItems: 'center', justifyContent: 'flex-start', cursor: 'pointer', transition: 'background .15s ease',
  },
  toggleThumb: {
    width: 18, height: 18, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.14)',
    transition: 'transform .15s ease',
  },
  installSmallGrid: { width: 68, height: 34, alignSelf: 'center', justifyContent: 'center', padding: '0 12px', borderRadius: 10, background: '#17191c', color: '#fff' },
  appIcon: {
    width: 32, height: 32, flex: 'none', display: 'grid', placeItems: 'center', overflow: 'hidden',
    borderRadius: 6, background: colors.subtle, color: colors.secondary,
  },
  cardBody: { minWidth: 0, flex: 1 },
  titleRow: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  stateBadges: { flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 },
  stateBadge: {
    display: 'inline-flex', alignItems: 'center', padding: '0 8px', borderRadius: 999,
    background: colors.subtle, color: colors.caption, fontSize: 10, fontWeight: 600, lineHeight: '19px',
    whiteSpace: 'nowrap',
  },
  name: { overflow: 'hidden', color: colors.text, fontSize: 13, fontWeight: 600, lineHeight: '19px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { display: 'block', marginTop: 2, color: colors.secondary, fontSize: 11, lineHeight: '16px', wordBreak: 'break-word' },
  description: {
    display: '-webkit-box', overflow: 'hidden', marginTop: 4, color: colors.secondary,
    fontSize: 12, lineHeight: '17px', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3,
  },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  chip: { padding: '1px 6px', borderRadius: 999, background: colors.surface, color: colors.secondary, fontSize: 10, lineHeight: '17px' },
  activeChip: { background: colors.accentSoft, color: colors.accent },
  warningChip: { background: arkmeTheme.warningSoft, color: colors.warning },
  error: { gridColumn: '1 / -1', margin: '0 0 10px', padding: '10px 12px', borderRadius: 10, background: arkmeTheme.dangerSoft, color: colors.danger, fontSize: 12 },
  installStatus: { gridColumn: '1 / -1', margin: '0 0 10px', padding: '10px 12px', borderRadius: 10, background: colors.accentSoft, color: colors.secondary, fontSize: 12 },
  restartNotice: { gridColumn: '1 / -1', margin: '0 0 10px', padding: '10px 12px', borderRadius: 10, background: colors.accentSoft, color: colors.secondary, fontSize: 12 },
  empty: { gridColumn: '1 / -1', display: 'grid', justifyItems: 'center', padding: '46px 18px 24px', textAlign: 'center' },
  emptyIcon: { width: 38, height: 38, display: 'grid', placeItems: 'center', color: colors.caption },
  emptyTitle: { marginTop: 13, color: colors.text, fontSize: 13, fontWeight: 600, lineHeight: '20px' },
  emptyDesc: { maxWidth: 230, marginTop: 4, color: colors.secondary, fontSize: 11, lineHeight: '17px' },
  skeleton: { height: 76, marginBottom: 8, borderRadius: 12, background: colors.subtle, opacity: .72 },
  detail: { width: '100%', maxWidth: 860, margin: '0 auto', paddingBottom: 20, boxSizing: 'border-box' },
  detailLead: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 26,
    alignItems: 'start', padding: '2px 0 24px',
  },
  detailLeadWithoutPreview: { gridTemplateColumns: 'minmax(0, 1fr)' },
  detailIdentity: { minWidth: 0, padding: '8px 0' },
  detailHero: { minWidth: 0, flex: '1 1 320px', display: 'flex', gap: 14, alignItems: 'flex-start' },
  detailTitleRow: { minWidth: 0, display: 'flex', alignItems: 'center', columnGap: 16, rowGap: 8, flexWrap: 'wrap' },
  detailName: { margin: 0, color: colors.text, fontSize: 24, lineHeight: '32px', fontWeight: 680, wordBreak: 'break-word' },
  detailTitleActions: {
    minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
  },
  detailMetrics: {
    display: 'flex', alignItems: 'center', columnGap: 18, rowGap: 6, flexWrap: 'wrap', marginTop: 9,
    color: colors.caption, fontSize: 11, lineHeight: '16px',
  },
  detailMetric: { display: 'inline-flex', alignItems: 'center', gap: 4, color: colors.caption, fontSize: 11, fontWeight: 400, lineHeight: '16px' },
  detailEnabledControl: {
    minHeight: 30, display: 'inline-flex', alignItems: 'center', gap: 9,
    color: colors.secondary, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap',
  },
  detailAuditAction: { marginTop: 10 },
  detailPreview: { minWidth: 0 },
  detailColumns: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    gap: 28, marginTop: 4, padding: '22px 0', borderTop: `1px solid ${colors.border}`,
  },
  detailAbout: { minWidth: 0, boxSizing: 'border-box' },
  detailFacts: { minWidth: 0, boxSizing: 'border-box' },
  detailSectionTitle: { margin: '0 0 10px', color: colors.text, fontSize: 14, lineHeight: '22px', fontWeight: 650 },
  detailIcon: { width: 46, height: 46, display: 'grid', placeItems: 'center', borderRadius: 13, background: colors.subtle, color: colors.secondary },
  detailSection: { padding: '12px 0', borderTop: `1px solid ${colors.border}` },
  detailLabel: { color: colors.caption, fontSize: 10, lineHeight: '16px' },
  detailValue: { marginTop: 3, color: colors.secondary, fontSize: 12, lineHeight: '18px', wordBreak: 'break-word' },
  auditPanel: {
    margin: '0 0 12px', padding: '10px 11px', border: `1px solid ${colors.border}`, borderRadius: 10,
    background: colors.subtle, color: colors.secondary, fontSize: 11, lineHeight: '17px',
  },
  auditPanelDanger: { background: arkmeTheme.dangerSoft, color: colors.danger },
  auditButton: {
    height: 28, flex: 'none', padding: '0 10px', border: `1px solid ${colors.border}`, borderRadius: 8,
    background: 'transparent', color: colors.caption, font: 'inherit', fontSize: 11, fontWeight: 500, cursor: 'pointer',
  },
  auditTitle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, color: colors.text, fontSize: 12, fontWeight: 650, lineHeight: '18px' },
  auditMeta: { marginTop: 4, color: colors.caption, fontSize: 10, lineHeight: '15px' },
  auditList: { margin: '7px 0 0', paddingLeft: 17 },
  detailHint: { marginTop: 12, padding: '10px 11px', borderRadius: 10, background: colors.accentSoft, color: colors.secondary, fontSize: 11, lineHeight: '17px' },
  detailDanger: {
    height: 32, marginTop: 14, padding: '0 14px', border: `1px solid ${colors.border}`, borderRadius: 9,
    background: 'transparent', color: colors.danger, font: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  detailConfirm: { marginTop: 14, padding: '10px 11px', borderRadius: 10, background: 'rgba(194,65,59,.08)', color: colors.danger, fontSize: 11, lineHeight: '17px' },
  detailConfirmActions: { display: 'flex', gap: 8, marginTop: 9 },
  detailDangerZone: { marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.border}` },
  primaryButton: {
    height: 34, flex: 'none', padding: '0 17px', border: 0, borderRadius: 9, background: ARKME_EXTENSION_PRIMARY_ACTION_BG,
    color: ARKME_EXTENSION_PRIMARY_ACTION_FG, font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  secondaryButton: {
    height: 34, flex: 'none', padding: '0 13px', border: `1px solid ${colors.border}`, borderRadius: 9,
    background: 'transparent', color: colors.secondary, font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  loadingButton: {
    width: 28, height: 28, flex: 'none', alignSelf: 'center', display: 'grid', placeItems: 'center',
    padding: 0, border: 0, borderRadius: 8, background: colors.accentSoft, color: colors.accent, cursor: 'pointer',
  },
  restartOverlay: {
    position: 'fixed', zIndex: 130, inset: 0, display: 'grid', placeItems: 'center',
    padding: 24, boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(17, 24, 39, .18))',
  },
  restartDialog: {
    width: 'min(380px, 100%)', padding: 20, boxSizing: 'border-box', borderRadius: 14,
    border: `1px solid ${colors.border}`, background: ARKME_EXTENSION_RESTART_SURFACE,
    color: colors.text, boxShadow: '0 18px 50px rgba(20,24,31,.20)',
  },
  restartTitle: { margin: 0, color: colors.text, fontSize: 16, lineHeight: '24px', fontWeight: 600 },
  restartDescription: { margin: '8px 0 0', color: colors.secondary, fontSize: 12, lineHeight: '19px' },
  restartActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
  restartLater: {
    height: 34, padding: '0 15px', border: `1px solid ${colors.border}`, borderRadius: 9,
    background: 'transparent', color: colors.secondary, font: 'inherit', fontSize: 12,
    cursor: 'pointer', appearance: 'none',
  },
  restartPrimary: {
    height: 34, padding: '0 17px', border: 0, borderRadius: 9,
    background: ARKME_EXTENSION_PRIMARY_ACTION_BG, color: ARKME_EXTENSION_PRIMARY_ACTION_FG,
    font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', appearance: 'none',
  },
}

export function ArkmeExtensionRestartDialog({ kind, restarting, onLater, onRestart }: {
  kind: 'apply' | 'disable' | 'remove' | 'unavailable'
  restarting: boolean
  onLater(): void
  onRestart(): void
}) {
  const disabledStyle: CSSProperties = restarting ? { opacity: .62, cursor: 'default' } : {}
  return <div style={styles.restartOverlay}>
    <section style={styles.restartDialog} role="alertdialog" aria-modal="true" aria-labelledby="arkme-extension-restart-title">
      <h3 id="arkme-extension-restart-title" style={styles.restartTitle}>{kind === 'unavailable' ? '插件不可用' : '需要重启 DSH'}</h3>
      <p style={styles.restartDescription}>
        {kind === 'unavailable'
          ? `${ARKME_EXTENSION_RUNTIME_UNAVAILABLE_MESSAGE} 请联系插件作者或安装兼容版本后重试。`
          : kind === 'disable'
          ? '扩展关闭状态已保存，重启后会停止当前进程中仍在运行的界面和能力。'
          : kind === 'remove'
          ? '扩展已卸载，重启后会从当前页面完全移除。'
          : '扩展已安装到插件列表，重启后立即生效。'}
      </p>
      <div style={styles.restartActions}>
        {kind === 'unavailable'
          ? <button type="button" style={styles.restartPrimary} onClick={onLater}>知道了</button>
          : <>
            <button type="button" style={{ ...styles.restartLater, ...disabledStyle }} disabled={restarting} onClick={onLater}>稍后</button>
            <button type="button" style={{ ...styles.restartPrimary, ...disabledStyle }} disabled={restarting} onClick={onRestart}>
              {restarting ? '正在重启…' : '立即重启'}
            </button>
          </>}
      </div>
    </section>
  </div>
}

const PENDING_EXTENSION_RESTART_KEY = 'arkme.extension.pending-restart'

const TAB_LABELS: Record<Tab, string> = { discover: '发现', installed: '已安装', mine: '我的扩展', updates: '更新' }
type MarketplaceCategory = string
export type MarketplaceAuthorFilter = {
  ownerUserId: number
  ownerName: string
}
const MARKET_SORTS: ReadonlyArray<{ value: MarketplaceSort; label: string }> = [
  { value: 'rating', label: '评分最高' },
  { value: 'comments', label: '评论最多' },
  { value: 'opens', label: '打开最多' },
  { value: 'created_at', label: '最新创建' },
]

function MarketplaceChevron({ open }: { open: boolean }) {
  return <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' }}>
    <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function filterMarketplaceMenuOptions<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  query: string,
): ReadonlyArray<{ value: T; label: string }> {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (normalizedQuery === '') return options
  return options.filter(option => option.label.toLocaleLowerCase().includes(normalizedQuery))
}

function MarketplaceMenu<T extends string>({
  ariaLabel, triggerLabel, value, options, available = true, hint, unavailableHint,
  searchable = false, searchPlaceholder = '搜索选项', emptySearchLabel = '未找到相关选项', onChange,
}: {
  ariaLabel: string
  triggerLabel: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  available?: boolean
  hint?: string
  unavailableHint?: string
  searchable?: boolean
  searchPlaceholder?: string
  emptySearchLabel?: string
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuSearchQuery, setMenuSearchQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const visibleOptions = searchable ? filterMarketplaceMenuOptions(options, menuSearchQuery) : options

  const closeMenu = () => {
    setOpen(false)
    setMenuSearchQuery('')
  }

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) closeMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div ref={rootRef} style={styles.marketplaceMenuRoot}>
    <button
      type="button"
      style={styles.marketplaceMenuButton}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => {
        if (open) closeMenu()
        else setOpen(true)
      }}
    >
      <span>{triggerLabel}</span>
      <MarketplaceChevron open={open} />
    </button>
    {open && <div style={styles.marketplaceMenu}>
      {searchable && <div style={styles.marketplaceMenuSearchWrap}>
        <input
          type="search"
          autoFocus
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={menuSearchQuery}
          style={styles.marketplaceMenuSearch}
          onChange={event => { setMenuSearchQuery(event.currentTarget.value) }}
        />
      </div>}
      <div role="listbox" aria-label={`${ariaLabel}选项`} style={styles.marketplaceMenuList}>
        {visibleOptions.map(option => {
          const selected = option.value === value
          const disabled = !available && !selected
          return <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={disabled}
            style={{
              ...styles.marketplaceMenuOption,
              ...(selected ? { background: colors.subtle, color: colors.text, fontWeight: 600 } : {}),
              ...(disabled ? { opacity: .45, cursor: 'not-allowed' } : {}),
            }}
            onClick={() => { onChange(option.value); closeMenu() }}
          >
            <span>{option.label}</span>
            {selected && <span aria-hidden>✓</span>}
          </button>
        })}
      </div>
      {menuSearchQuery.trim() !== '' && visibleOptions.length === 0
        && <div role="status" style={styles.marketplaceMenuEmpty}>{emptySearchLabel}</div>}
      {hint !== undefined && <div role="note" style={styles.marketplaceMenuHint}>{hint}</div>}
      {!available && unavailableHint !== undefined && <div role="note" style={styles.marketplaceMenuHint}>{unavailableHint}</div>}
    </div>}
  </div>
}

export function marketplaceListParams(
  searchQuery: string,
  sort: MarketplaceSort,
  sortingEnabled: boolean,
  cursor?: string,
  authorFilter?: Pick<MarketplaceAuthorFilter, 'ownerUserId'>,
): {
  limit: number
  query?: string
  sort?: MarketplaceSort
  cursor?: string
  ownerUserId?: number
} {
  const query = searchQuery.trim()
  const normalizedCursor = cursor?.trim() ?? ''
  return {
    limit: ARKME_EXTENSION_MARKETPLACE_PAGE_SIZE,
    ...(query === '' ? {} : { query }),
    ...(sortingEnabled ? { sort } : {}),
    ...(normalizedCursor === '' ? {} : { cursor: normalizedCursor }),
    ...(authorFilter === undefined ? {} : {
      ownerUserId: authorFilter.ownerUserId,
    }),
  }
}

export function shouldLoadMoreDiscoverPage(
  target: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>,
  threshold = 240,
): boolean {
  return target.scrollHeight - target.scrollTop - target.clientHeight <= threshold
}

export function classificationStatusHint(status: ArkmeExtensionClassificationStatus, message?: string): string | undefined {
  if (message !== undefined && message.trim() !== '') return message
  if (status === 'building') return 'AI 正在更新分类，已有分类仍可继续浏览。'
  if (status === 'failed') return 'AI 分类更新失败，全部扩展仍可继续浏览。'
  if (status === 'empty') return 'AI 分类暂无数据，全部扩展仍可继续浏览。'
  if (status === 'unavailable') return 'AI 分类暂不可用，全部扩展仍可继续浏览。'
  return undefined
}

export function marketplaceCategoryOptions(
  tree: Pick<ArkmeExtensionClassificationTree, 'categories' | 'total_extensions'>,
  catalogTotal = tree.total_extensions,
): ReadonlyArray<{ value: MarketplaceCategory; label: string }> {
  return [
    { value: 'all', label: `全部 · ${String(catalogTotal)}` },
    ...tree.categories.map(item => ({
      value: item.category_id,
      label: `${item.name} · ${String(item.extension_count)}`,
    })),
  ]
}

export function extensionDetailHasPreviews(
  previews: readonly Pick<ArkmeExtensionPreviewItem, 'preview_ref'>[] | undefined,
): boolean {
  return previews?.some(item => /^preview_v1_[a-f0-9]{64}$/.test(item.preview_ref)) === true
}
const EMPTY_COPY: Record<Tab, { title: string; description: string }> = {
  discover: { title: '还没有可发现的扩展', description: '和 DSH 对话生成并发布扩展后，它会出现在这里。' },
  installed: { title: '还没有安装扩展', description: '从发现页选择扩展，或在 DSH 对话中指定 extension_id。' },
  mine: { title: '还没有我的扩展', description: '和 DSH 生成 Cordis 扩展，或把自建 Bundle 加入当前 Profile。' },
  updates: { title: '所有扩展均为最新版本', description: '有新版本或安全撤销时，会在这里提醒你。' },
}

function CloseIcon() {
  return <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
}

function LinkIcon() {
  return <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none">
    <path d="M10.2 13.8a4.1 4.1 0 0 0 5.8 0l3-3A4.1 4.1 0 1 0 13.2 5l-1.7 1.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.8 10.2a4.1 4.1 0 0 0-5.8 0l-3 3A4.1 4.1 0 1 0 10.8 19l1.7-1.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function ArkmeExtensionDetailHeader({ title, copyAvailable, copyNotice = '', onCopy, onClose }: {
  title: string
  copyAvailable: boolean
  copyNotice?: string
  onCopy(): void
  onClose(): void
}) {
  return <header style={styles.detailModalHeader}>
    <h2 id="arkme-extension-detail-title" style={styles.detailModalTitle}>{title}</h2>
    {copyAvailable && <button
      type="button"
      style={styles.detailModalHeaderAction}
      aria-label="复制扩展链接"
      title="复制链接"
      onClick={onCopy}
      onMouseEnter={event => { event.currentTarget.style.background = colors.hover }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
    >
      <LinkIcon />
      {copyNotice !== '' && <span role="status" style={styles.detailCopyNotice}>{copyNotice}</span>}
    </button>}
    <button
      type="button"
      style={styles.detailModalHeaderAction}
      aria-label="关闭扩展详情"
      title="关闭"
      onClick={onClose}
      onMouseEnter={event => { event.currentTarget.style.background = colors.hover }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
    ><CloseIcon /></button>
  </header>
}

function Chips({ children }: { children: ReactNode }) { return <div style={styles.chips}>{children}</div> }

function Chip({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'active' | 'warning' }) {
  return <span style={{ ...styles.chip, ...(tone === 'active' ? styles.activeChip : tone === 'warning' ? styles.warningChip : {}) }}>{children}</span>
}

export function ArkmeExtensionManifestDetails({ manifest }: { manifest: unknown }) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return null
  const value = manifest as Record<string, unknown>
  const runtime = value.runtime
  const halves = value.halves
  if (runtime === null || typeof runtime !== 'object' || Array.isArray(runtime)
    || halves === null || typeof halves !== 'object' || Array.isArray(halves)
    || typeof (runtime as Record<string, unknown>).dsh !== 'string'
    || typeof (halves as Record<string, unknown>).host !== 'boolean'
    || typeof (halves as Record<string, unknown>).client !== 'boolean') return null
  const safeRuntime = runtime as { dsh: string }
  const safeHalves = halves as { host: boolean; client: boolean }
  const permissions = Array.isArray(value.permissions)
    ? value.permissions.filter((permission): permission is string => typeof permission === 'string')
    : []
  if (!safeHalves.host && !safeHalves.client && safeRuntime.dsh.trim() === '' && permissions.length === 0) return null
  return <section style={styles.detailSection}>
    <div style={styles.detailLabel}>运行能力</div>
    <Chips>
      {safeHalves.host && <Chip>Host</Chip>}
      {safeHalves.client && <Chip>Client</Chip>}
      {safeRuntime.dsh.trim() !== '' && <Chip>{safeRuntime.dsh}</Chip>}
      {permissions.map(permission => <Chip key={permission}>{permission}</Chip>)}
    </Chips>
  </section>
}

function auditVerdictLabel(result: ArkmeExtensionAuditResult): string {
  if (result.verdict === 'pass') return 'AI 审核通过'
  if (result.verdict === 'reject') return 'AI 审核建议拒绝'
  return 'AI 审核建议复核'
}

function auditRiskLabel(result: ArkmeExtensionAuditResult): string {
  const risk = result.risk_level === 'critical' ? '严重'
    : result.risk_level === 'high' ? '高'
    : result.risk_level === 'medium' ? '中'
    : '低'
  return `${risk}风险`
}

function ArkmeExtensionAuditPanel({ result }: { result: ArkmeExtensionAuditResult }) {
  const dangerous = result.verdict === 'reject' || result.risk_level === 'critical' || result.risk_level === 'high'
  const details = result.reasons.length > 0 ? result.reasons : result.recommendations
  return <section style={{ ...styles.auditPanel, ...(dangerous ? styles.auditPanelDanger : {}) }} aria-live="polite">
    <div style={styles.auditTitle}>
      <span>{auditVerdictLabel(result)}</span>
      <span>{auditRiskLabel(result)}</span>
    </div>
    <div style={styles.auditMeta}>
      {result.source_reviewed ? '已审核已发布源码快照' : '基于公开详情与版本事实审核'}
      {result.model === undefined ? '' : ` · ${result.model.name ?? result.model.model}`}
    </div>
    <div style={{ marginTop: 7 }}>{result.summary}</div>
    {details.length > 0 && <ul style={styles.auditList}>
      {details.map((item, index) => <li key={`${String(index)}-${item}`}>{item}</li>)}
    </ul>}
  </section>
}

export function ArkmeExtensionAuditAction({ extensionId, busyExtensionId, onRun }: {
  extensionId: string
  busyExtensionId?: string | undefined
  onRun(extensionId: string): void
}) {
  const busy = busyExtensionId === extensionId
  return <button
    type="button"
    style={{ ...styles.auditButton, ...(busy ? { opacity: .62, cursor: 'default' } : {}) }}
    disabled={busy}
    onClick={() => { onRun(extensionId) }}
  >{busy ? '审核中...' : 'AI 审核'}</button>
}

export function ArkmeExtensionAuditFeedback({ error, result }: {
  error: string
  result?: ArkmeExtensionAuditResult | undefined
}) {
  return <>
    {error !== '' && <section style={{ ...styles.auditPanel, ...styles.auditPanelDanger }} role="alert">{error}</section>}
    {result !== undefined && <ArkmeExtensionAuditPanel result={result} />}
  </>
}

function LoadingIcon() {
  return <svg aria-hidden width="15" height="15" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" opacity=".22" />
    <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur=".8s" repeatCount="indefinite" />
    </path>
  </svg>
}

function InstallLoadingButton({ task, onPause, onResume }: {
  task?: ArkmeExtensionInstallTaskSnapshot | undefined
  onPause?: (() => void) | undefined
  onResume?: (() => void) | undefined
}) {
  const paused = task?.phase === 'paused'
  const pausable = task !== undefined && ['resolving', 'downloading'].includes(task.phase)
  const action = paused ? onResume : pausable ? onPause : undefined
  const label = paused ? '继续安装' : pausable ? '暂停安装' : '正在处理'
  return <button
    type="button" style={{ ...styles.loadingButton, ...(action === undefined ? { cursor: 'default' } : {}) }}
    disabled={action === undefined} aria-label={label} title={label} onClick={action}
  >{paused
      ? <svg aria-hidden width="13" height="13" viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" /></svg>
      : <LoadingIcon />}</button>
}

export function ArkmeExtensionToggle({ item, busy, onChange }: {
  item: ArkmeInstalledExtensionView
  busy: boolean
  onChange(enabled: boolean): void
}) {
  return <button
    type="button"
    role="switch"
    aria-label={`${item.enabled ? '关闭' : '启用'}扩展 ${item.manifest.name}`}
    aria-checked={item.enabled}
    disabled={busy}
    style={{
      ...styles.toggle,
      background: item.enabled ? colors.accent : '#eeeeee',
      opacity: busy ? .55 : 1,
    }}
    onClick={() => { onChange(!item.enabled) }}
  >
    <span style={{ ...styles.toggleThumb, transform: item.enabled ? 'translateX(18px)' : 'translateX(0)' }} />
  </button>
}

function StarIcon() {
  return <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
}

function CommentIcon() {
  return <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
}

function InstallUsersIcon() {
  return <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16.5v2A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function EyeIcon() {
  return <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M2.5 12c2.3-4 5.5-6 9.5-6s7.2 2 9.5 6c-2.3 4-5.5 6-9.5 6s-7.2-2-9.5-6Z" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" /></svg>
}

export function formatCompactCount(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(safe >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}m`
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(safe >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`
  return String(Math.trunc(safe))
}

export function extensionDetailMetricLabels(
  item: Pick<ArkmeExtensionCatalogItem, 'rating_summary' | 'install_user_count' | 'comment_count' | 'open_count' | 'view_count'>,
): string[] {
  const labels: string[] = []
  if (item.rating_summary !== undefined) {
    labels.push(`★ ${item.rating_summary.average.toFixed(1)}`)
  }
  if (item.comment_count !== undefined) labels.push(`评论 ${formatCompactCount(item.comment_count)}`)
  const views = item.open_count ?? item.view_count
  if (views !== undefined) labels.push(`查看 ${formatCompactCount(views)}`)
  if (item.install_user_count !== undefined) labels.push(`安装 ${formatCompactCount(item.install_user_count)}`)
  return labels
}

export function ArkmeExtensionDetailMetrics({ item }: {
  item: Pick<ArkmeExtensionCatalogItem, 'rating_summary' | 'install_user_count' | 'comment_count' | 'open_count' | 'view_count'>
}) {
  const views = item.open_count ?? item.view_count
  if (item.rating_summary === undefined && item.install_user_count === undefined && item.comment_count === undefined && views === undefined) return null
  return <div style={styles.detailMetrics} aria-label="扩展统计" data-extension-detail-metrics="compact">
    {item.rating_summary !== undefined && <span style={styles.detailMetric} aria-label={`评分 ${item.rating_summary.average.toFixed(1)}`}>
      <StarIcon />{item.rating_summary.average.toFixed(1)}
    </span>}
    {item.comment_count !== undefined && <span style={styles.detailMetric} aria-label={`${String(item.comment_count)} 条评论`}>
      <CommentIcon />{formatCompactCount(item.comment_count)}
    </span>}
    {views !== undefined && <span style={styles.detailMetric} aria-label={`查看次数 ${String(views)}`}>
      <EyeIcon />{formatCompactCount(views)}
    </span>}
    {item.install_user_count !== undefined && <span style={styles.detailMetric} aria-label={`${String(item.install_user_count)} 人已安装`}>
      <InstallUsersIcon />{formatCompactCount(item.install_user_count)}
    </span>}
  </div>
}

export function formatMarketplaceDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  const millis = value < 10_000_000_000 ? value * 1000 : value
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function extensionCommunityAuthor(item: ArkmeExtensionCatalogItem): { name: string; github: boolean } {
  if (effectiveExtensionPublisherRole(item) === 'importer' && item.source?.type === 'github_repository') {
    return { name: 'GitHub', github: true }
  }
  const ownerName = item.owner_name?.trim() ?? ''
  if (ownerName !== '') return { name: ownerName, github: false }
  return { name: extensionAuthorLabel(item), github: false }
}

function safeGithubAvatarUrl(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized === '') return undefined
  try {
    const url = new URL(normalized)
    return url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com' ? url.toString() : undefined
  } catch { return undefined }
}

function safeGithubProfileUrl(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized === '') return undefined
  try {
    const url = new URL(normalized)
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.toString() : undefined
  } catch { return undefined }
}

export function extensionGithubProfileUrl(item: ArkmeExtensionCatalogItem): string | undefined {
  const projected = safeGithubProfileUrl(item.source_author?.profile_url)
  if (projected !== undefined) return projected
  if (item.source?.type !== 'github_repository') return undefined
  try {
    const url = new URL(item.source.url)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return undefined
    const owner = url.pathname.split('/').filter(Boolean)[0]
    return owner === undefined || !/^[A-Za-z0-9-]{1,39}$/.test(owner) ? undefined : `https://github.com/${owner}`
  } catch { return undefined }
}

function ExtensionAuthorAvatar({ item, size }: { item: ArkmeExtensionCatalogItem; size: number }) {
  if (extensionCommunityAuthor(item).github) {
    const githubAvatar = safeGithubAvatarUrl(item.source_author?.avatar_url)
    if (githubAvatar !== undefined) return <img src={githubAvatar} alt="" style={{ width: size, height: size, flex: 'none', borderRadius: '50%', objectFit: 'cover' }} />
    return <GitHubIdentityAvatar size={size} />
  }
  const hasOwnerIdentity = (item.owner_user_id ?? 0) > 0
    || (item.owner_name?.trim() ?? '') !== ''
    || (item.owner_arkme_id?.trim() ?? '') !== ''
  if (hasOwnerIdentity) return <ArkmeUserAvatar
    {...(item.owner_avatar_ref === undefined ? {} : { avatarRef: item.owner_avatar_ref })}
    {...(item.owner_avatar_fallback === undefined ? {} : { fallback: item.owner_avatar_fallback })}
    size={size}
    label={`${extensionCommunityAuthor(item).name}的头像`}
  />
  const githubAvatar = safeGithubAvatarUrl(item.source_author?.avatar_url)
  if (githubAvatar !== undefined) return <img src={githubAvatar} alt="" style={{ width: size, height: size, flex: 'none', borderRadius: '50%', objectFit: 'cover' }} />
  return <ArkmeUserAvatar
    {...(item.owner_avatar_ref === undefined ? {} : { avatarRef: item.owner_avatar_ref })}
    {...(item.owner_avatar_fallback === undefined ? {} : { fallback: item.owner_avatar_fallback })}
    size={size}
    label={`${extensionCommunityAuthor(item).name}的头像`}
  />
}

function GitHubIdentityAvatar({ size = 18 }: { size?: number }) {
  const iconSize = Math.max(13, Math.round(size * .72))
  return <span
    style={{ ...styles.communityIdentityAvatar, width: size, height: size }}
    aria-label="GitHub 来源"
    data-extension-community-identity="github"
  >
    <svg aria-hidden="true" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.184 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.866-.014-1.7-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.621.069-.608.069-.608 1.004.071 1.532 1.034 1.532 1.034.892 1.53 2.341 1.088 2.91.832.091-.647.349-1.088.635-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.987 1.029-2.686-.103-.253-.446-1.268.098-2.645 0 0 .84-.269 2.75 1.026A9.555 9.555 0 0112 6.844a9.55 9.55 0 012.504.337c1.909-1.295 2.747-1.026 2.747-1.026.546 1.377.203 2.392.1 2.645.64.699 1.028 1.593 1.028 2.686 0 3.847-2.339 4.695-4.566 4.943.359.31.678.923.678 1.86 0 1.343-.012 2.425-.012 2.755 0 .268.18.58.688.481A10.025 10.025 0 0022 12.021C22 6.484 17.523 2 12 2z" />
    </svg>
  </span>
}

export function ArkmeExtensionAuthorIdentity({ item, size = 18, presentation = 'community' }: {
  item: ArkmeExtensionCatalogItem
  size?: number
  presentation?: 'community' | 'detail'
}) {
  const author = extensionCommunityAuthor(item)
  return <span
    style={presentation === 'community'
      ? styles.communityIdentityRow
      : { minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}
    data-extension-community-identity-row={author.github ? 'github' : 'author'}
  >
    {author.github
      ? <GitHubIdentityAvatar size={size} />
      : <span
          style={{ ...styles.communityIdentityAvatar, width: size, height: size }}
          data-extension-community-identity="author"
        >
          <ExtensionAuthorAvatar item={item} size={size} />
        </span>}
    <span style={presentation === 'community' ? styles.communityIdentityName : undefined}>{author.name}</span>
  </span>
}

export function ArkmeExtensionAuthorTrigger({
  item,
  size = 28,
  presentation = 'detail',
  expanded = false,
  style,
  onToggle,
}: {
  item: ArkmeExtensionCatalogItem
  size?: number
  presentation?: 'community' | 'detail'
  expanded?: boolean
  style?: CSSProperties
  onToggle?: (() => void) | undefined
}) {
  const identity = <ArkmeExtensionAuthorIdentity item={item} size={size} presentation={presentation} />
  if (extensionCommunityAuthor(item).github) {
    const href = extensionGithubProfileUrl(item)
    if (href === undefined) return <span
      style={{ ...styles.authorButton, ...style, cursor: 'default' }}
      data-extension-author-identity="github-static"
    >{identity}</span>
    return <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="在 GitHub 查看作者"
      data-extension-author-direct-link="github"
      style={{ ...styles.authorButton, ...style, textDecoration: 'none' }}
    >{identity}</a>
  }
  return <button
    type="button"
    style={{ ...styles.authorButton, ...style }}
    aria-expanded={expanded}
    onClick={onToggle}
  >{identity}</button>
}

export function extensionAuthorWorldTarget(
  item: Pick<ArkmeExtensionCatalogItem, 'publisher_role' | 'source' | 'owner_user_id' | 'owner_name' | 'owner_avatar_ref' | 'owner_avatar_fallback'>,
): ArkmeWorldTarget | undefined {
  if (effectiveExtensionPublisherRole(item) !== 'author') return undefined
  const userId = item.owner_user_id
  if (!Number.isSafeInteger(userId) || (userId ?? 0) <= 0) return undefined
  const displayName = item.owner_name?.replace(/\s+/g, ' ').trim() || '这位用户'
  const fallback = item.owner_avatar_fallback?.kind === 'phone_default'
    ? item.owner_avatar_fallback
    : undefined
  return {
    userId: userId!,
    displayName,
    ...(item.owner_avatar_ref === undefined ? {} : { avatarRef: item.owner_avatar_ref }),
    ...(fallback === undefined ? {} : { avatarFallback: fallback }),
  }
}

export async function executeExtensionShareAuthorAction(
  item: ArkmeExtensionCatalogItem,
  action: ArkmeExtensionShareAction,
  handlers: {
    openPrivateChat(target: ArkmeWorldTarget): Promise<void>
    openWorld(target: ArkmeWorldTarget): void
  },
): Promise<void> {
  const target = extensionAuthorWorldTarget(item)
  if (target === undefined) throw new Error('该扩展没有可操作的 Arkme 站内作者')
  if (action === 'author-world') {
    handlers.openWorld(target)
    return
  }
  await handlers.openPrivateChat(target)
}

export function ArkmeExtensionAuthorPopover({
  item,
  open,
  currentUserId,
  actionBusy = false,
  actionError = '',
  onToggle,
  onPrivateChat,
  onOtherExtensions,
  onWorld,
  style,
}: {
  item: ArkmeExtensionCatalogItem
  open: boolean
  currentUserId?: number | undefined
  actionBusy?: boolean
  actionError?: string
  onToggle(): void
  onPrivateChat(): void
  onOtherExtensions(): void
  onWorld(): void
  style?: CSSProperties
}) {
  const worldTarget = extensionAuthorWorldTarget(item)
  const canMessage = worldTarget !== undefined && item.owner_user_id !== currentUserId
  const canBrowseOtherExtensions = worldTarget !== undefined
  const navigationPending = useRef(false)
  const openWorld = () => {
    if (navigationPending.current || worldTarget === undefined) return
    navigationPending.current = true
    onWorld()
  }
  return <div style={{ ...styles.authorPopoverRoot, ...style }}>
    <ArkmeExtensionAuthorTrigger item={item} expanded={open} onToggle={onToggle} />
    {open && !extensionCommunityAuthor(item).github && <aside
      style={styles.authorCard}
      role="dialog"
      aria-label={`${extensionCommunityAuthor(item).name}的个人资料`}
      data-extension-author-popover="profile"
    >
      <div style={styles.authorCardHeader}>
        <ExtensionAuthorAvatar item={item} size={52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={styles.authorCardName}>{extensionCommunityAuthor(item).name}</div>
        </div>
        {worldTarget !== undefined && <button
          type="button"
          style={styles.authorCardProfileIcon}
          aria-label={`进入${extensionCommunityAuthor(item).name}的世界`}
          data-extension-author-profile-link="icon"
          onClick={openWorld}
        ><ArrowUpRight size={17} aria-hidden /></button>}
      </div>
      {worldTarget !== undefined && <button
        type="button"
        style={styles.authorCardWorldLink}
        data-extension-author-world-link="true"
        onClick={openWorld}
      >进入 TA 的世界 <CaretRight size={13} weight="bold" aria-hidden /></button>}
      {actionError !== '' && <div style={{ ...styles.error, marginTop: 8 }}>{actionError}</div>}
      {(canMessage || canBrowseOtherExtensions) && <div style={styles.authorCardActions}>
        {canMessage && <button
          type="button"
          style={{ ...styles.authorCardMessageButton, ...(actionBusy ? { opacity: .62, cursor: 'default' } : {}) }}
          disabled={actionBusy}
          onClick={onPrivateChat}
        >{actionBusy ? '正在打开…' : '发送消息'}</button>}
        {canBrowseOtherExtensions && <button
          type="button"
          style={styles.authorCardExtensionsButton}
          disabled={actionBusy}
          data-extension-author-other-extensions="true"
          onClick={onOtherExtensions}
        >TA 的全部插件</button>}
      </div>}
    </aside>}
  </div>
}

export function ExtensionCard({ item, installed, actionLabel, status, statusColor, installTask, actionBusy, onClick, onAction, onToggle, onPause, onResume, presentation = 'list' }: {
  item: ArkmeExtensionCatalogItem
  installed?: ArkmeInstalledExtensionView | undefined
  actionLabel?: string | undefined
  status?: string | undefined
  statusColor?: string | undefined
  installTask?: ArkmeExtensionInstallTaskSnapshot | undefined
  actionBusy?: boolean
  grid?: boolean
  onClick(): void
  onAction?: (() => void) | undefined
  onToggle?: ((enabled: boolean) => void) | undefined
  onPause?: (() => void) | undefined
  onResume?: (() => void) | undefined
  presentation?: 'list' | 'community'
}) {
  const metadata = extensionCardMetadata(item)
  if (presentation === 'community') {
    return <article
      style={styles.communityCard}
      data-extension-community-card="true"
      onMouseEnter={event => {
        event.currentTarget.style.background = colors.hover
        event.currentTarget.style.boxShadow = '0 6px 18px rgba(20, 24, 31, .07)'
      }}
      onMouseLeave={event => {
        event.currentTarget.style.background = colors.surface
        event.currentTarget.style.boxShadow = 'none'
      }}
    >
      <button type="button" style={styles.communityPrimary} title={item.name} aria-label={`查看扩展：${item.name}`} onClick={onClick}>
        <ArkmeExtensionAvatar extensionId={item.extension_id} iconRef={item.icon_ref} size={34} />
        <span style={styles.communityTitleRow} data-extension-title-row="true">
          <span style={styles.communityTitle}>{item.name}</span>
          <ArkmeExtensionAuthorIdentity item={item} />
        </span>
      </button>
    </article>
  }
  return <div
    style={styles.card}
    onMouseEnter={event => { event.currentTarget.style.background = colors.hover }}
    onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
  >
    <button type="button" style={styles.cardPrimary} onClick={onClick}>
      <ArkmeExtensionAvatar extensionId={item.extension_id} iconRef={item.icon_ref} />
      <span style={styles.cardBody}>
        <span style={styles.name}>{item.name}</span>
        <span style={styles.description}>{item.description || '这个扩展还没有填写说明。'}</span>
        {metadata !== '' && <span style={styles.meta}>{metadata}</span>}
        {item.rating_summary !== undefined && <span style={styles.meta}>★ {extensionRatingLabel(item.rating_summary)}</span>}
        {status !== undefined && <span style={{ ...styles.meta, color: statusColor ?? colors.secondary }}>{status}</span>}
      </span>
    </button>
    {(installTask !== undefined && !installTask.done) || (actionBusy === true && actionLabel !== undefined) ? <InstallLoadingButton
      task={installTask} onPause={onPause} onResume={onResume}
    /> : <span style={styles.actionGroup}>
      {actionLabel !== undefined && <button
        type="button"
        style={{ ...styles.installSmall, ...(onAction === undefined ? { opacity: .45, cursor: 'not-allowed' } : {}) }}
        disabled={onAction === undefined || actionBusy === true}
        onClick={onAction}
      >{actionLabel}</button>}
      {installed !== undefined && onToggle !== undefined && <ArkmeExtensionToggle
        item={installed} busy={actionBusy === true} onChange={onToggle}
      />}
    </span>}
  </div>
}

function extensionHasAuthorIdentity(item: ArkmeExtensionCatalogItem): boolean {
  return item.source?.type === 'github_repository'
    || item.owner_user_id !== undefined
    || (item.owner_name?.trim() ?? '') !== ''
    || (item.owner_arkme_id?.trim() ?? '') !== ''
}

export function ArkmeExtensionLifecycleRow({
  item,
  installed,
  kind,
  actionBusy = false,
  installTask,
  onOpen,
  onUpdate,
  onToggle,
  onPause,
  onResume,
}: {
  item: ArkmeExtensionCatalogItem
  installed: ArkmeInstalledExtensionView
  kind: 'installed' | 'update'
  actionBusy?: boolean | undefined
  installTask?: ArkmeExtensionInstallTaskSnapshot | undefined
  onOpen(): void
  onUpdate?: (() => void) | undefined
  onToggle?: ((enabled: boolean) => void) | undefined
  onPause?: (() => void) | undefined
  onResume?: (() => void) | undefined
}) {
  const processing = (installTask !== undefined && !installTask.done) || actionBusy
  return <article style={styles.lifecycleRow} data-extension-lifecycle-row={kind}>
    <button type="button" style={styles.lifecyclePrimary} onClick={onOpen} aria-label={`查看扩展：${item.name}`}>
      <ArkmeExtensionAvatar extensionId={item.extension_id} iconRef={item.icon_ref} size={38} />
      <span style={styles.lifecycleCopy}>
        <span style={styles.lifecycleTitle}>{item.name}</span>
        {extensionHasAuthorIdentity(item) && <span style={styles.lifecycleAuthor}>
          <ArkmeExtensionAuthorIdentity item={item} size={20} />
        </span>}
      </span>
    </button>
    {kind === 'installed' && onToggle !== undefined && <span style={styles.lifecycleActions}>
      <ArkmeExtensionToggle
        item={installed}
        busy={actionBusy}
        onChange={onToggle}
      />
    </span>}
    {kind === 'update' && <span style={styles.lifecycleActions}>
      {processing ? <InstallLoadingButton task={installTask} onPause={onPause} onResume={onResume} /> : <button
        type="button"
        style={{ ...styles.installSmall, height: 32, padding: '0 16px', background: '#17191c', color: '#fff' }}
        disabled={onUpdate === undefined}
        onClick={onUpdate}
      >更新</button>}
    </span>}
  </article>
}

export function MyExtensionCard({ item, installed, toggleBusy = false, onPublish, onEdit, onOpen, onToggle }: {
  item: ArkmeMyExtensionItem
  installed?: ArkmeInstalledExtensionView | undefined
  toggleBusy?: boolean | undefined
  onPublish?(): void
  onEdit?(): void
	onOpen?(): void
  onToggle?(enabled: boolean): void
}) {
  const action = myExtensionPrimaryAction(item)
  const version = displayVersion(item.published?.version ?? item.persisted?.version)
  return <div
    style={styles.card}
    onMouseEnter={event => { event.currentTarget.style.background = colors.hover }}
    onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
  >
    <ArkmeExtensionAvatar extensionId={item.published?.extensionId ?? item.ownedRef} iconRef={item.published?.iconRef} />
    <span style={styles.cardBody}>
      <span style={styles.titleRow}>
        <span style={styles.name}>{item.name}</span>
        <span style={styles.stateBadges}>
          {myExtensionBadges(item.states).map(label => <span key={label} style={styles.stateBadge}>{label}</span>)}
          {item.persisted?.artifactContractVersion === 3 && <span style={styles.stateBadge}>V3 原生</span>}
        </span>
      </span>
      <span style={styles.description}>{item.description || '这个扩展还没有填写说明。'}</span>
      {version !== '' && <span style={styles.meta}>{version}</span>}
    </span>
    <span style={styles.actionGroup}>
		{item.published !== undefined && <button type="button" style={styles.restartLater} onClick={onOpen}>详情</button>}
      {action !== undefined && <button
        type="button"
        style={{ ...styles.installSmall, ...((action.kind === 'publish' ? onPublish : onEdit) === undefined ? { opacity: .45, cursor: 'not-allowed' } : {}) }}
        disabled={(action.kind === 'publish' ? onPublish : onEdit) === undefined}
        onClick={action.kind === 'publish' ? onPublish : onEdit}
      >{action.label}</button>}
      {installed !== undefined && onToggle !== undefined && <ArkmeExtensionToggle
        item={installed} busy={toggleBusy} onChange={onToggle}
      />}
    </span>
  </div>
}

function EmptyState({ tab }: { tab: Tab }) {
  const copy = EMPTY_COPY[tab]
  return <div style={styles.empty}>
    <span style={styles.emptyIcon}><ArkmeExtensionIcon size={22} /></span>
    <span style={styles.emptyTitle}>{copy.title}</span>
    <span style={styles.emptyDesc}>{copy.description}</span>
  </div>
}

function LoadingState() {
  return <div aria-label="正在加载扩展"><div style={styles.skeleton} /><div style={styles.skeleton} /><div style={styles.skeleton} /></div>
}

export function extensionInstallPercent(task: Pick<ArkmeExtensionInstallTaskSnapshot, 'phase' | 'downloadedBytes' | 'totalBytes'>): number {
  switch (task.phase) {
    case 'resolving': return 4
    case 'downloading': {
      if (task.totalBytes === undefined || task.totalBytes <= 0) return task.downloadedBytes === 0 ? 8 : 24
      return Math.min(75, 8 + Math.round(67 * Math.min(1, (task.downloadedBytes ?? 0) / task.totalBytes)))
    }
    case 'verifying': return 80
    case 'persisting': return 87
    case 'registering': return 90
    case 'applying': return 94
    case 'paused': return 0
    case 'awaiting-approval':
    case 'installed':
    case 'active':
    case 'failed': return 100
  }
}

export function formatExtensionBytes(bytes: number): string {
  const safe = Math.max(0, bytes)
  if (safe < 1024) return `${String(safe)} B`
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} KB`
  return `${(safe / (1024 * 1024)).toFixed(1)} MB`
}

export function extensionInstallFailureMessage(
  task: Pick<ArkmeExtensionInstallTaskSnapshot, 'done' | 'phase' | 'message' | 'error'> | undefined,
): string | undefined {
  if (task?.done !== true || task.phase !== 'failed') return undefined
  const message = task.error?.message.trim() || task.message?.trim() || ''
  return message === '' ? '扩展安装失败，请重试。' : message
}

export function extensionCatalogAction(
  item: Pick<ArkmeExtensionCatalogItem, 'latest_stable_version' | 'version'>,
  installedVersion?: string,
  owned = false,
): { label: '安装' | '更新' | '已安装' | '未发布'; disabled: boolean } {
  const latest = item.version ?? item.latest_stable_version
  if (owned && latest === undefined) return { label: '未发布', disabled: true }
  if (installedVersion === undefined) return { label: '安装', disabled: false }
  if (latest === undefined) return { label: '已安装', disabled: true }
  return installedVersion === latest
    ? { label: '已安装', disabled: true }
    : { label: '更新', disabled: false }
}

function displayVersion(value: string | undefined): string {
  const normalized = value?.trim().replace(/^v/i, '') ?? ''
  return normalized === '' ? '' : `v${normalized}`
}

export function extensionVersionLabel(
  item: Pick<ArkmeExtensionCatalogItem, 'latest_stable_version' | 'version'>,
): string {
  return displayVersion(item.version ?? item.latest_stable_version)
}

export function extensionCardMetadata(
  item: Pick<ArkmeExtensionCatalogItem, 'latest_stable_version' | 'version' | 'manifest'>,
): string {
  return extensionVersionLabel(item)
}

export function extensionUpdateCardStatus(item: ArkmeExtensionUpdateResolution): string | undefined {
  if (!item.revoked) return undefined
  return item.revocation_reason?.trim() || '当前版本已撤销'
}

export function actionableExtensionUpdates(
  items: readonly ArkmeExtensionUpdateResolution[],
): ArkmeExtensionUpdateResolution[] {
  return items.filter(item => item.update_available && !item.revoked)
}

export function extensionDirectInstallTarget(
  item: Pick<ArkmeExtensionCatalogItem, 'extension_id' | 'latest_stable_version' | 'version'>,
): { extensionId: string; version?: string } {
  const version = item.version ?? item.latest_stable_version
  return {
    extensionId: item.extension_id,
    ...(version === undefined ? {} : { version }),
  }
}

export function extensionInstallOwnerId(
  currentSessionId: string | undefined,
  instanceId: string | undefined,
): string | undefined {
  const session = currentSessionId?.trim() ?? ''
  if (session !== '') return session
  const instance = instanceId?.trim() ?? ''
  return instance === '' ? undefined : `profile:${instance}`
}

export function extensionNativeInstallWarning(
  preview: Pick<ArkmeExtensionInstallPreview,
    'execution_model' | 'package_name' | 'artifact_contract_version' | 'native_capabilities'
    | 'audit_status' | 'audit_risk_level' | 'audit_reason'>,
): string | undefined {
  if (preview.execution_model !== 'dsh-native') return undefined
  const labels: Record<string, string> = {
    runtime_dependencies: '运行依赖', optional_dependencies: '可选依赖', bundled_dependencies: '捆绑依赖',
    peer_dependencies: '外部 Peer', lifecycle_scripts: '安装脚本', bin: '命令行程序', native_addon: '原生模块',
    profile_patch_override: '修改现有 Profile 配置', external_package_reference: '加载其他依赖包',
  }
  const capabilities = (preview.native_capabilities ?? []).map(item => labels[item] ?? item)
  const detail = capabilities.length === 0 ? '' : ` 检测到：${capabilities.join('、')}。`
  const contract = preview.artifact_contract_version === 3 ? 'V3 原生 DSH Package' : '原生 DSH Bundle'
  const auditWarning = preview.audit_status === 'warning'
    ? ` AI 风险审核提示（${preview.audit_risk_level ?? '未知等级'}）：${preview.audit_reason?.trim() || '该原生插件需要额外复核'}。`
    : ''
  return `扩展 ${preview.package_name ?? '（未知 package）'} 是${contract}，将以 DSH 插件进程权限运行。${detail}${auditWarning}确认继续安装吗？`
}

export function extensionAuthorLabel(
  item: Pick<ArkmeExtensionCatalogItem, 'owner_user_id' | 'owner_name' | 'owner_arkme_id'>,
): string {
  const displayName = item.owner_name?.trim() ?? ''
  const arkmeId = item.owner_arkme_id?.trim().replace(/^@+/, '') ?? ''
  if (displayName !== '' && arkmeId !== '') return `${displayName} · @${arkmeId}`
  if (displayName !== '') return displayName
  if (arkmeId !== '') return `@${arkmeId}`
  if (item.owner_user_id !== undefined) return `Arkme 用户 ${String(item.owner_user_id)}`
  return '作者信息暂不可用'
}

export function installedExtensionCatalogItem(item: ArkmeInstalledExtensionView, iconRef?: string): ArkmeExtensionCatalogItem {
  return {
    extension_id: item.extensionId,
    name: item.manifest.name,
    description: item.manifest.description,
    visibility: 'private',
    version: item.installedVersion,
    manifest: item.manifest,
    ...(iconRef === undefined ? {} : { icon_ref: iconRef }),
  }
}

export function mergeInstalledExtensionCatalogItem(
  item: ArkmeInstalledExtensionView,
  remote?: ArkmeExtensionCatalogItem,
  iconRef?: string,
): ArkmeExtensionCatalogItem {
  const local = installedExtensionCatalogItem(item, iconRef)
  if (remote === undefined) return local
  return {
    ...local,
    ...remote,
    extension_id: item.extensionId,
    name: remote.name.trim() === '' ? local.name : remote.name,
    description: remote.description.trim() === '' ? local.description : remote.description,
    version: item.installedVersion,
    manifest: item.manifest,
    ...(remote.icon_ref === undefined && iconRef !== undefined ? { icon_ref: iconRef } : {}),
  }
}

export function extensionEnabledLabel(item: ArkmeInstalledExtensionView): string {
  if (!item.enabled) return item.active || item.restartRequired ? '已关闭，重启后完全停用' : '已关闭'
  return item.active ? '已启用' : '已启用，尚未加载'
}

export function extensionEnableUnavailable(
  item: ArkmeInstalledExtensionView | undefined,
  enabled: boolean,
): boolean {
  return enabled && item?.unavailable !== undefined
}

export function ArkmeMarketplace({
  currentSessionId, currentUserId, currentUserAvatarRef, shareRef, shareAction, initialExtensionId, initialAuthorFilter,
  onShareResolved, onShareExit, onClose,
  displayMode = 'dialog', onPrivateChatOpened, sortingEnabled = true,
}: {
  currentSessionId?: string | undefined
  currentUserId?: number | undefined
  currentUserAvatarRef?: string | undefined
  shareRef?: string | undefined
  shareAction?: ArkmeExtensionShareAction | undefined
  initialExtensionId?: string | undefined
  initialAuthorFilter?: MarketplaceAuthorFilter | undefined
  onShareResolved?(extensionId: string): void
  onShareExit?(): void
  onClose?: (() => void) | undefined
  displayMode?: 'dialog' | 'page'
  onPrivateChatOpened?: ((source: ArkmeSourceItem) => void) | undefined
  sortingEnabled?: boolean
}) {
  const [tab, setTab] = useState<Tab>('discover')
  const [discoverItems, setDiscoverItems] = useState<ArkmeExtensionCatalogItem[]>([])
  const [publishedItems, setPublishedItems] = useState<ArkmeExtensionCatalogItem[]>([])
  const [discoverOwnerWarning, setDiscoverOwnerWarning] = useState('')
  const [myExtensions, setMyExtensions] = useState<ArkmeMyExtensionItem[]>([])
  const [myExtensionWarnings, setMyExtensionWarnings] = useState<ArkmeMyExtensionPage['warnings']>([])
  const [installed, setInstalled] = useState<ArkmeInstalledExtensionView[]>([])
  const [updates, setUpdates] = useState<ArkmeExtensionUpdateResolution[]>([])
  const [lifecycleCatalogItems, setLifecycleCatalogItems] = useState<Record<string, ArkmeExtensionCatalogItem>>({})
  const [detail, setDetail] = useState<ArkmeExtensionCatalogItem>()
  const [detailRequestedExtensionId, setDetailRequestedExtensionId] = useState<string>()
  const [loadingTab, setLoadingTab] = useState<Tab | undefined>(shareRef === undefined ? 'discover' : undefined)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [installTask, setInstallTask] = useState<ArkmeExtensionInstallTaskSnapshot>()
  const [actionBusyExtensionId, setActionBusyExtensionId] = useState<string>()
  const [installError, setInstallError] = useState('')
  const [restartNotice, setRestartNotice] = useState('')
  const [restartPrompt, setRestartPrompt] = useState<{
    extensionId: string
    kind: 'apply' | 'disable' | 'remove' | 'unavailable'
  }>()
  const [uninstallConfirmExtensionId, setUninstallConfirmExtensionId] = useState<string>()
  const [query, setQuery] = useState('')
  const [restarting, setRestarting] = useState(false)
  const [publishItem, setPublishItem] = useState<ArkmeMyExtensionItem>()
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [editItem, setEditItem] = useState<ArkmeMyExtensionItem>()
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')
  const [shareNotice, setShareNotice] = useState('')
  const [sharedDetail, setSharedDetail] = useState<ArkmeSharedExtensionDetail>()
  const [sharedDetailBusy, setSharedDetailBusy] = useState(false)
  const [auditBusyExtensionId, setAuditBusyExtensionId] = useState<string>()
  const [auditResult, setAuditResult] = useState<ArkmeExtensionAuditResult>()
  const [auditError, setAuditError] = useState('')
  const [deleteConfirmExtensionId, setDeleteConfirmExtensionId] = useState<string>()
  const [loadedTabs, setLoadedTabs] = useState<ReadonlySet<Tab>>(new Set())
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [category, setCategory] = useState<MarketplaceCategory>('all')
  const [classificationTree, setClassificationTree] = useState<ArkmeExtensionClassificationTree>({
    status: 'unavailable', categories: [], total_extensions: 0, total_categories: 0,
  })
  const [sort, setSort] = useState<MarketplaceSort>(() => readMarketplaceSortPreference(currentUserId))
  const [catalogTotal, setCatalogTotal] = useState<number>()
  const [discoverNextCursor, setDiscoverNextCursor] = useState<string>()
  const [loadingMoreDiscover, setLoadingMoreDiscover] = useState(false)
  const [loadMoreDiscoverError, setLoadMoreDiscoverError] = useState('')
  const [authorFilter, setAuthorFilter] = useState<MarketplaceAuthorFilter | undefined>(() => initialAuthorFilter)
  const [authorCardOpen, setAuthorCardOpen] = useState(false)
  const [authorActionBusy, setAuthorActionBusy] = useState(false)
  const [authorActionError, setAuthorActionError] = useState('')
  const requestSequence = useRef(0)
  const requestController = useRef<AbortController>()
  const loadMoreController = useRef<AbortController>()
  const loadMoreSequence = useRef(0)
  const loadingMoreDiscoverRef = useRef(false)
  const discoverListRef = useRef<HTMLElement>(null)
  const classificationController = useRef<AbortController>()
  const publishMutation = useRef<ExtensionPublishMutation>()
  const editMutation = useRef<ExtensionEditMutation>()
  const detailDialogRef = useRef<HTMLElement>(null)
  const openedInitialExtensionIdRef = useRef<string>()
  const detailReturnFocus = useRef<HTMLElement>()
  const promptedRestartExtensions = useRef(new Set<string>())
  const preserveResolvedShareDetail = useRef(false)

  const categoryOptions = marketplaceCategoryOptions(
    classificationTree,
    catalogTotal ?? classificationTree.total_extensions,
  )
  const selectedCategoryName = category === 'all'
    ? '全部'
    : classificationTree.categories.find(item => item.category_id === category)?.name ?? '全部'
  const classificationHint = classificationStatusHint(classificationTree.status, classificationTree.message)

  const closeDetail = (restoreFocus = true) => {
    const dismissPendingShare = shareRef !== undefined && sharedDetail === undefined
    setDetailRequestedExtensionId(undefined); setDetail(undefined); setDetailBusy(false); setDetailError('')
    setInstallTask(undefined); setInstallError(''); setUninstallConfirmExtensionId(undefined); setDeleteConfirmExtensionId(undefined)
    setShareNotice(''); setAuthorCardOpen(false); setAuthorActionError('')
    const target = detailReturnFocus.current
    detailReturnFocus.current = undefined
    if (restoreFocus && target !== undefined && typeof window !== 'undefined') window.setTimeout(() => { target.focus() }, 0)
    if (dismissPendingShare) onShareExit?.()
  }

  const hostInstance = async (): Promise<string | undefined> => {
    try { return (await callArkme<{ instanceId: string }>('provider.instance')).instanceId }
    catch { return undefined }
  }

  const acceptInstalled = (local: ArkmeInstalledExtensionView[]): void => {
    setInstalled(local)
    const repairPending = local.find(item => item.restartRequired === true && item.unavailable === undefined)
    if (repairPending !== undefined && !promptedRestartExtensions.current.has(repairPending.extensionId)) {
      promptedRestartExtensions.current.add(repairPending.extensionId)
      setRestartNotice(repairPending.enabled
        ? '扩展启用状态等待重启后生效。'
        : '已修复扩展关闭状态；重启后会完全停用当前仍在运行的界面和能力。')
      setRestartPrompt({
        extensionId: repairPending.extensionId,
        kind: repairPending.enabled ? 'apply' : 'disable',
      })
    }
    if (typeof window === 'undefined') return
    let pendingExtensionId: string | null = null
    try { pendingExtensionId = window.sessionStorage.getItem(PENDING_EXTENSION_RESTART_KEY) } catch { return }
    if (pendingExtensionId === null || pendingExtensionId === '') return
    const pending = local.find(item => item.extensionId === pendingExtensionId)
    if (pending?.unavailable !== undefined) {
      setRestartPrompt({ extensionId: pendingExtensionId, kind: 'unavailable' })
      try { window.sessionStorage.removeItem(PENDING_EXTENSION_RESTART_KEY) } catch { /* Best-effort UI marker cleanup. */ }
    } else if (pending?.active === true) {
      try { window.sessionStorage.removeItem(PENDING_EXTENSION_RESTART_KEY) } catch { /* Best-effort UI marker cleanup. */ }
    }
  }

  const loadLifecycleCatalogItems = async (
    extensionIds: readonly string[],
    owned: readonly ArkmeExtensionCatalogItem[],
    signal: AbortSignal,
  ): Promise<Record<string, ArkmeExtensionCatalogItem>> => {
    const uniqueIds = [...new Set(extensionIds)]
    const resolved = await Promise.all(uniqueIds.map(async extensionId => {
      try {
        return await callArkme<ArkmeExtensionCatalogItem>('extensions.catalog.detail', { extensionId }, signal)
      } catch (caught) {
        if ((caught as Error).name === 'AbortError') throw caught
        return owned.find(item => item.extension_id === extensionId)
      }
    }))
    return Object.fromEntries(resolved.flatMap(item => item === undefined ? [] : [[item.extension_id, item]]))
  }

  const reloadAfterRestart = async (previous: string | undefined): Promise<void> => {
    if (previous === undefined || typeof window === 'undefined') return
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 300))
      const next = await hostInstance()
      if (next !== undefined && next !== previous) {
        window.location.reload()
        return
      }
    }
    setRestarting(false)
    setInstallError('DSH 重启超时，请手动重启后刷新页面。')
  }

  useEffect(() => {
    setSort(readMarketplaceSortPreference(currentUserId))
  }, [currentUserId])

  useEffect(() => {
    classificationController.current?.abort()
    const controller = new AbortController()
    classificationController.current = controller
    void callArkme<ArkmeExtensionClassificationTree>(
      'extensions.classification.tree',
      { limit: 50 },
      controller.signal,
    ).then(tree => {
      setClassificationTree(tree)
      setCategory(current => current === 'all' || tree.categories.some(item => item.category_id === current) ? current : 'all')
    }).catch(caught => {
      if ((caught as Error).name !== 'AbortError') {
        setClassificationTree({
          status: 'unavailable', categories: [], total_extensions: 0, total_categories: 0,
          message: caught instanceof Error ? caught.message : 'AI 分类暂不可用。',
        })
        setCategory('all')
      }
    })
    return () => { controller.abort() }
  }, [])

  const load = async (
    target: Tab,
    mode: 'initial' | 'refresh' = extensionTabLoadMode(loadedTabs, target),
    preserveDetail = false,
  ) => {
    const sequence = ++requestSequence.current
    requestController.current?.abort()
    loadMoreController.current?.abort()
    loadMoreSequence.current += 1
    loadingMoreDiscoverRef.current = false
    setLoadingMoreDiscover(false)
    setLoadMoreDiscoverError('')
    if (target === 'discover') setDiscoverNextCursor(undefined)
    const controller = new AbortController()
    requestController.current = controller
    if (mode === 'initial') setLoadingTab(target)
    setError(''); setInstallError('')
    if (!preserveDetail) { setDetail(undefined); setDetailRequestedExtensionId(undefined); setDetailError('') }
    setAuditResult(undefined); setAuditError('')
    try {
      if (target === 'discover') {
        void callArkme<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, controller.signal)
          .then(local => {
            if (sequence === requestSequence.current) acceptInstalled(local)
          })
          .catch(() => undefined)
        void callArkme<ArkmeExtensionCatalogPage>('extensions.my-list', undefined, controller.signal)
          .then(owned => {
            if (sequence !== requestSequence.current) return
            setPublishedItems(owned.items)
            setDiscoverOwnerWarning('')
          })
          .catch(caught => {
            if ((caught as Error).name !== 'AbortError' && sequence === requestSequence.current) {
              setDiscoverOwnerWarning('你的私有扩展暂未加载，请稍后刷新。')
            }
          })
        const page = await (category === 'all'
          ? callArkme<ArkmeExtensionCatalogPage>(
              'extensions.catalog.list',
              marketplaceListParams(searchQuery, sort, sortingEnabled, undefined, authorFilter),
              controller.signal,
            )
          : callArkme<ArkmeExtensionClassificationPage>(
              'extensions.classification.items',
              { categoryId: category, ...marketplaceListParams(searchQuery, sort, sortingEnabled) },
              controller.signal,
            ))
        if (sequence === requestSequence.current) {
          setDiscoverItems(page.items)
          setDiscoverNextCursor(page.next_cursor?.trim() || undefined)
          if (category === 'all') setCatalogTotal(page.total)
        }
      } else if (target === 'mine') {
        const [page, local] = await Promise.all([
          callArkme<ArkmeMyExtensionPage>('extensions.mine.list', {
            ...(currentSessionId === undefined || currentSessionId.trim() === '' ? {} : { currentSessionId: currentSessionId.trim() }),
          }, controller.signal),
          callArkme<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, controller.signal),
        ])
        if (sequence === requestSequence.current) {
          setMyExtensions(page.items); setMyExtensionWarnings(page.warnings); acceptInstalled(local)
        }
      } else if (target === 'installed') {
        const [local, owned] = await Promise.all([
          callArkme<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, controller.signal),
          callArkme<ArkmeExtensionCatalogPage>('extensions.my-list', undefined, controller.signal)
            .catch(() => ({ items: [], total: 0 })),
        ])
        const catalogItems = await loadLifecycleCatalogItems(local.map(item => item.extensionId), owned.items, controller.signal)
        if (sequence === requestSequence.current) {
          acceptInstalled(local); setLifecycleCatalogItems(catalogItems); setPublishedItems(owned.items)
        }
      } else {
        const [local, available, owned] = await Promise.all([
          callArkme<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, controller.signal),
          callArkme<ArkmeExtensionUpdateResolution[]>('extensions.updates', undefined, controller.signal),
          callArkme<ArkmeExtensionCatalogPage>('extensions.my-list', undefined, controller.signal)
            .catch(() => ({ items: [], total: 0 })),
        ])
        const actionable = actionableExtensionUpdates(available)
        const catalogItems = await loadLifecycleCatalogItems(
          actionable.map(item => item.extension_id), owned.items, controller.signal,
        )
        if (sequence === requestSequence.current) {
          acceptInstalled(local); setUpdates(available); setLifecycleCatalogItems(catalogItems); setPublishedItems(owned.items)
        }
      }
      if (sequence === requestSequence.current) setLoadedTabs(current => new Set(current).add(target))
    } catch (caught) {
      if (mode === 'initial' && (caught as Error).name !== 'AbortError' && sequence === requestSequence.current) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoadingTab(current => current === target ? undefined : current)
      }
    }
  }

  const loadMoreDiscoverPage = async () => {
    const cursor = discoverNextCursor?.trim() ?? ''
    if (tab !== 'discover' || cursor === '' || loadingMoreDiscoverRef.current || loadingTab === 'discover') return
    loadingMoreDiscoverRef.current = true
    const paginationSequence = ++loadMoreSequence.current
    const requestAtStart = requestSequence.current
    loadMoreController.current?.abort()
    const controller = new AbortController()
    loadMoreController.current = controller
    setLoadingMoreDiscover(true)
    setLoadMoreDiscoverError('')
    try {
      const page = category === 'all'
        ? await callArkme<ArkmeExtensionCatalogPage>(
            'extensions.catalog.list',
            marketplaceListParams(searchQuery, sort, sortingEnabled, cursor, authorFilter),
            controller.signal,
          )
        : await callArkme<ArkmeExtensionClassificationPage>(
            'extensions.classification.items',
            { categoryId: category, ...marketplaceListParams(searchQuery, sort, sortingEnabled, cursor) },
            controller.signal,
          )
      if (paginationSequence !== loadMoreSequence.current || requestAtStart !== requestSequence.current) return
      setDiscoverItems(current => appendExtensionDiscoverPage(current, page.items))
      const nextCursor = page.next_cursor?.trim() ?? ''
      setDiscoverNextCursor(nextCursor === '' || nextCursor === cursor ? undefined : nextCursor)
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError'
        && paginationSequence === loadMoreSequence.current
        && requestAtStart === requestSequence.current) {
        setLoadMoreDiscoverError(caught instanceof Error ? caught.message : '加载更多失败')
      }
    } finally {
      if (paginationSequence === loadMoreSequence.current) {
        loadingMoreDiscoverRef.current = false
        setLoadingMoreDiscover(false)
      }
    }
  }

  useEffect(() => {
    if (displayMode !== 'page' || tab !== 'discover' || discoverNextCursor === undefined
      || loadingMoreDiscover || loadingTab === 'discover' || loadMoreDiscoverError !== '') return
    const frame = window.requestAnimationFrame(() => {
      const target = discoverListRef.current
      if (target !== null && shouldLoadMoreDiscoverPage(target)) void loadMoreDiscoverPage()
    })
    return () => { window.cancelAnimationFrame(frame) }
  }, [displayMode, tab, discoverNextCursor, discoverItems.length, loadingMoreDiscover, loadingTab, loadMoreDiscoverError])

  useEffect(() => {
    if (shareRef !== undefined) return
    if (preserveResolvedShareDetail.current) {
      preserveResolvedShareDetail.current = false
      return
    }
    const timer = window.setTimeout(() => { void load('discover', 'initial') }, searchQuery.trim() === '' ? 0 : 250)
    return () => {
      window.clearTimeout(timer)
      requestController.current?.abort()
      loadMoreController.current?.abort()
    }
  }, [shareRef, searchQuery, sort, category, sortingEnabled, authorFilter?.ownerUserId])

  useEffect(() => {
    if (shareRef === undefined) return
    const controller = new AbortController()
    setSharedDetail(undefined); setSharedDetailBusy(false); setDetail(undefined); setError('')
    setDetailRequestedExtensionId(`share:${shareRef}`); setDetailBusy(true); setDetailError('')
    setTab('discover')
    void load('discover', 'initial', true)
    void resolveExtensionSharePresentation(shareRef, controller.signal)
      .then(async presentation => {
        if (controller.signal.aborted) return
        if (presentation.kind === 'catalog') {
          if (shareAction !== undefined) {
            await executeExtensionShareAuthorAction(presentation.detail, shareAction, {
              openWorld: target => {
                onShareExit?.()
                arkmeUi.showUserWorld(target)
              },
              openPrivateChat: async target => {
                const result = await callArkme<ArkmeOpenPrivateChatResult>('chat.private.open', {
                  peerUserId: target.userId,
                  displayName: target.displayName,
                }, controller.signal)
                if (controller.signal.aborted) return
                onShareExit?.()
                onPrivateChatOpened?.(result.source)
              },
            })
            return
          }
          preserveResolvedShareDetail.current = true
          if (onShareResolved !== undefined) {
            onShareResolved(presentation.detail.extension_id)
          } else {
            setDetailRequestedExtensionId(presentation.detail.extension_id); setDetail(presentation.detail); setDetailBusy(false)
            onShareExit?.()
          }
        } else {
          if (shareAction !== undefined) throw new Error('当前分享链接无法解析 Arkme 作者')
          setDetailRequestedExtensionId(undefined); setDetail(undefined); setDetailBusy(false); setSharedDetail(presentation.detail)
        }
      })
      .catch(caught => {
        if ((caught as Error).name !== 'AbortError' && !controller.signal.aborted) {
          setDetailBusy(false)
          setDetailError(caught instanceof Error ? caught.message : String(caught))
        }
      })
    return () => { controller.abort() }
  }, [shareRef, shareAction])

  const switchTab = (target: Tab) => {
    if (shareRef !== undefined) { setSharedDetail(undefined); onShareExit?.() }
    const selection = extensionTabSelection(tab, target, loadedTabs)
    if (selection.changed) {
      setTab(target); setError(''); setDetail(undefined); setDetailRequestedExtensionId(undefined); setDetailError('')
      setInstallError(''); setInstallTask(undefined); setUninstallConfirmExtensionId(undefined); setDeleteConfirmExtensionId(undefined)
      setAuditResult(undefined); setAuditError('')
    }
    void load(target, selection.mode)
  }

  const inspect = async (extensionId: string) => {
    if (detailRequestedExtensionId === undefined && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      detailReturnFocus.current = document.activeElement
    }
    setDetailRequestedExtensionId(extensionId); setDetail(undefined); setDetailBusy(true); setDetailError('')
    setInstallError(''); setInstallTask(undefined); setAuthorCardOpen(false); setAuthorActionError('')
    setUninstallConfirmExtensionId(undefined); setDeleteConfirmExtensionId(undefined); setShareNotice('')
    setAuditResult(undefined); setAuditError('')
    try {
      let listed = [...publishedItems, ...discoverItems].find(item => item.extension_id === extensionId)
      const ownedListed = publishedItems.find(item => item.extension_id === extensionId)
      const local = installed.find(item => item.extensionId === extensionId)
      if (tab === 'discover' && ownedListed?.visibility === 'private') {
        const preview = await callArkme<ArkmeExtensionInstallPreview>('extensions.install.preview', { extensionId })
        setDetail({ ...ownedListed, version: preview.version, manifest: preview.manifest })
        return
      }
      if (tab === 'mine' && listed !== undefined
        && listed.latest_stable_version === undefined && listed.version === undefined) {
        setDetail(listed)
        return
      }
      if (tab === 'mine') {
        const preview = await callArkme<ArkmeExtensionInstallPreview>('extensions.install.preview', { extensionId })
        setDetail({
          extension_id: extensionId,
          name: listed?.name ?? preview.manifest.name,
          description: listed?.description ?? preview.manifest.description,
          ...(listed?.owner_user_id === undefined ? {} : { owner_user_id: listed.owner_user_id }),
          ...(listed?.owner_name === undefined ? {} : { owner_name: listed.owner_name }),
          ...(listed?.owner_arkme_id === undefined ? {} : { owner_arkme_id: listed.owner_arkme_id }),
          ...(listed?.icon_ref === undefined ? {} : { icon_ref: listed.icon_ref }),
          visibility: listed?.visibility ?? 'private',
          version: preview.version,
          manifest: preview.manifest,
        })
      } else {
        try {
          const remote = await callArkme<ArkmeExtensionCatalogItem>('extensions.catalog.detail', { extensionId })
          setDetail(local === undefined ? remote : {
            ...installedExtensionCatalogItem(local),
            ...remote,
            manifest: remote.manifest ?? local.manifest,
          })
        } catch (caught) {
          if (local === undefined) throw caught
          if (listed === undefined) {
            const owned = await callArkme<ArkmeExtensionCatalogPage>('extensions.my-list').catch(() => undefined)
            if (owned !== undefined) {
              setPublishedItems(owned.items)
              listed = owned.items.find(item => item.extension_id === extensionId)
            }
          }
          setDetail({ ...installedExtensionCatalogItem(local), ...(listed ?? {}), manifest: local.manifest })
        }
      }
    }
    catch (caught) { setDetailError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setDetailBusy(false) }
  }

  useEffect(() => {
    const extensionId = initialExtensionId?.trim()
    if (extensionId === undefined || extensionId === '' || openedInitialExtensionIdRef.current === extensionId) return
    openedInitialExtensionIdRef.current = extensionId
    void inspect(extensionId)
  }, [initialExtensionId])

  useEffect(() => {
    if (initialAuthorFilter === undefined) return
    setTab('discover')
    setCategory('all')
    setAuthorFilter(current => current?.ownerUserId === initialAuthorFilter.ownerUserId
      && current.ownerName === initialAuthorFilter.ownerName
      ? current
      : initialAuthorFilter)
  }, [initialAuthorFilter?.ownerUserId, initialAuthorFilter?.ownerName])

  const runAudit = async (extensionId: string) => {
    setAuditBusyExtensionId(extensionId); setAuditError(''); setAuditResult(undefined)
    try {
      const result = await callArkme<ArkmeExtensionAuditResult>('extensions.audit.check', { extensionId })
      setAuditResult(result)
    } catch (caught) {
      setAuditError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setAuditBusyExtensionId(current => current === extensionId ? undefined : current)
    }
  }

  const startInstall = async (target: { extensionId: string; version?: string }) => {
    setActionBusyExtensionId(target.extensionId); setInstallError(''); setRestartNotice('')
    try {
      const preview = await callArkme<ArkmeExtensionInstallPreview>('extensions.install.preview', {
        extensionId: target.extensionId,
        ...(target.version === undefined ? {} : { version: target.version }),
      })
      const nativeWarning = extensionNativeInstallWarning(preview)
      if (nativeWarning !== undefined && !window.confirm(nativeWarning)) return
      const ownerId = extensionInstallOwnerId(currentSessionId, await hostInstance())
      if (ownerId === undefined) throw new Error('无法确认当前 DSH 实例，请刷新后重试。')
      const task = await callArkme<ArkmeExtensionInstallTaskSnapshot>('extensions.install.start', {
        extensionId: target.extensionId,
        ...(target.version === undefined ? {} : { version: target.version }),
        sessionId: ownerId,
      })
      setInstallTask(task)
    } catch (caught) {
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionBusyExtensionId(undefined)
    }
  }

  const controlInstall = async (operation: 'extensions.install.pause' | 'extensions.install.resume') => {
    if (installTask === undefined) return
    try {
      setInstallError('')
      setInstallTask(await callArkme<ArkmeExtensionInstallTaskSnapshot>(operation, {
        taskId: installTask.taskId,
        sessionId: installTask.sessionId,
      }))
    } catch (caught) {
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const uninstall = async (extensionId: string) => {
    setActionBusyExtensionId(extensionId); setInstallError(''); setRestartNotice('')
    try {
      const ownerId = extensionInstallOwnerId(currentSessionId, await hostInstance())
      if (ownerId === undefined) throw new Error('无法确认当前 DSH 实例，请刷新后重试。')
      const result = await callArkme<{ restart_required?: boolean }>('extensions.uninstall', {
        extensionId,
        sessionId: ownerId,
      })
      setInstalled(current => current.filter(item => item.extensionId !== extensionId))
      setUninstallConfirmExtensionId(undefined)
      setUpdates(current => current.filter(item => item.extension_id !== extensionId))
      setInstallTask(current => current?.extensionId === extensionId ? undefined : current)
      setLoadedTabs(current => {
        const updated = new Set(current).add('installed')
        updated.delete('updates')
        return updated
      })
      if (result.restart_required === true) {
        setRestartNotice('扩展已从 DSH 插件列表移除，请手动重启 DSH 完成卸载。')
        setRestartPrompt({ extensionId, kind: 'remove' })
      }
    } catch (caught) {
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionBusyExtensionId(undefined)
    }
  }

  const deletePublishedExtension = async (extensionId: string) => {
    setActionBusyExtensionId(extensionId); setInstallError(''); setRestartNotice('')
    try {
      const result = await callArkme<ArkmeExtensionCompleteDeleteResult>('extensions.delete', { extensionId })
      setDiscoverItems(current => current.filter(item => item.extension_id !== extensionId))
      setPublishedItems(current => current.filter(item => item.extension_id !== extensionId))
      setMyExtensions(current => current.filter(item => item.published?.extensionId !== extensionId))
      setInstalled(current => current.filter(item => item.extensionId !== extensionId))
      setUpdates(current => current.filter(item => item.extension_id !== extensionId))
      setLifecycleCatalogItems(current => Object.fromEntries(
        Object.entries(current).filter(([candidateId]) => candidateId !== extensionId),
      ))
      setInstallTask(current => current?.extensionId === extensionId ? undefined : current)
      setLoadedTabs(current => new Set(current).add('installed').add('mine').add('updates'))
      setUninstallConfirmExtensionId(undefined)
      closeDetail()
      setRestartNotice(result.restart_required
        ? '扩展已完全删除；请手动重启 DSH，使当前进程卸载残留的 Client/原生能力。'
        : '扩展已完全删除；市集、本地安装、运行态和引用中均不再保留。')
    } catch (caught) {
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionBusyExtensionId(undefined)
    }
  }

  const toggleEnabled = async (extensionId: string, enabled: boolean) => {
    setActionBusyExtensionId(extensionId); setInstallError(''); setRestartNotice('')
    if (extensionEnableUnavailable(installed.find(item => item.extensionId === extensionId), enabled)) {
      setRestartPrompt({ extensionId, kind: 'unavailable' })
      setActionBusyExtensionId(undefined)
      return
    }
    try {
      const result = await callArkme<ArkmeExtensionEnabledResult>('extensions.enabled.set', { extensionId, enabled })
      setInstalled(current => current.map(item => {
        if (item.extensionId !== extensionId) return item
        const { unavailable: _unavailable, restartRequired: _restartRequired, ...retained } = item
        return {
          ...retained,
          enabled: result.enabled,
          active: result.active,
          ...(result.restart_required ? { restartRequired: true } : {}),
          ...(result.unavailable === undefined ? {} : { unavailable: result.unavailable }),
        }
      }))
      if (result.unavailable !== undefined) {
        setRestartNotice('')
        setRestartPrompt({ extensionId, kind: 'unavailable' })
      } else {
        setRestartNotice(result.message)
        if (result.restart_required) {
          promptedRestartExtensions.current.add(extensionId)
          setRestartPrompt({ extensionId, kind: result.enabled ? 'apply' : 'disable' })
        }
      }
    } catch (caught) {
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionBusyExtensionId(undefined)
    }
  }

  useEffect(() => {
    if (installTask === undefined || installTask.done) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await callArkme<ArkmeExtensionInstallTaskSnapshot>('extensions.install.status', {
          taskId: installTask.taskId,
          sessionId: installTask.sessionId,
        }, controller.signal)
        setInstallTask(next)
        if (next.done) {
          const failureMessage = extensionInstallFailureMessage(next)
          if (failureMessage !== undefined) setInstallError(failureMessage)
          if (next.result?.restartRequired === true) {
            setRestartNotice('扩展已写入 DSH 插件列表，请手动重启 DSH 后生效。')
            setRestartPrompt({ extensionId: next.extensionId, kind: 'apply' })
          }
          if (next.phase !== 'failed' || next.result?.installed === true) {
            const local = await callArkme<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, controller.signal)
            acceptInstalled(local)
            if (local.find(item => item.extensionId === next.extensionId)?.unavailable !== undefined) {
              setRestartNotice('')
              setRestartPrompt({ extensionId: next.extensionId, kind: 'unavailable' })
            }
            setLoadedTabs(current => {
              const updated = new Set(current).add('installed')
              updated.delete('updates')
              return updated
            })
          }
          return
        }
        timer = setTimeout(() => { void poll() }, 300)
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') {
          setInstallError(caught instanceof Error ? caught.message : String(caught))
        }
      }
    }
    timer = setTimeout(() => { void poll() }, 200)
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [installTask?.taskId])

  const restartNow = async () => {
    if (restartPrompt === undefined || restartPrompt.kind === 'unavailable' || restarting) return
    setRestarting(true); setInstallError('')
    const previous = await hostInstance()
    if (restartPrompt.kind === 'apply' && typeof window !== 'undefined') {
      try { window.sessionStorage.setItem(PENDING_EXTENSION_RESTART_KEY, restartPrompt.extensionId) } catch { /* Reload fallback remains manual. */ }
    }
    try {
      await callArkme('extensions.restart', { extensionId: restartPrompt.extensionId })
      setRestartNotice('DSH 正在重启，完成后页面会自动刷新。')
      await reloadAfterRestart(previous)
    } catch (caught) {
      if (restartPrompt.kind === 'apply' && typeof window !== 'undefined') {
        try { window.sessionStorage.removeItem(PENDING_EXTENSION_RESTART_KEY) } catch { /* Best-effort UI marker cleanup. */ }
      }
      setRestarting(false)
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const publishMyExtension = async (item: ArkmeMyExtensionItem, value: ArkmeExtensionPublishFormValue) => {
    setPublishBusy(true); setPublishError('')
    try {
      const mutation = nextExtensionPublishMutation(publishMutation.current, item.ownedRef, value.version, () => crypto.randomUUID())
      publishMutation.current = mutation
      const { iconFile, ...publishValue } = value
      const result = await callArkme<ArkmeExtensionPublishResult>('extensions.mine.publish', {
        ownedRef: item.ownedRef,
        ...publishValue,
        clientMutationId: mutation.id,
      })
      publishMutation.current = undefined
      setPublishItem(undefined)
      await load('mine', 'refresh')
      if (iconFile !== undefined) {
        try {
          await extensionSdk.setExtensionIcon(result.extension_id, iconFile)
          await load('mine', 'refresh')
          setRestartNotice('扩展已发布，头像已同步。')
        } catch (iconError) {
          setInstallError(`扩展已发布，但头像上传失败：${iconError instanceof Error ? iconError.message : String(iconError)}`)
        }
      }
    } catch (caught) {
      setPublishError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPublishBusy(false)
    }
  }

  const saveMyExtensionEdit = async (item: ArkmeMyExtensionItem, value: ArkmeExtensionEditFormValue) => {
    const published = item.published
    if (published === undefined) return
    const extensionId = published.extensionId
    const mutation = nextExtensionEditMutation(editMutation.current, extensionId, value, () => crypto.randomUUID())
    editMutation.current = mutation
    setEditBusy(true); setEditError(''); setRestartNotice('')
    try {
      const baseline = publishedItems.find(candidate => candidate.extension_id === extensionId) ?? {
        extension_id: extensionId,
        name: item.name,
        description: item.description,
        visibility: published.visibility,
        ...(published.version === undefined ? {} : { version: published.version }),
        ...(published.iconRef === undefined ? {} : { icon_ref: published.iconRef }),
        ...(published.previewImages === undefined ? {} : { preview_images: published.previewImages }),
        ...(published.previewRevision === undefined ? {} : { preview_revision: published.previewRevision }),
      }
      const result = await saveExtensionEdit({ extension: baseline, value, clientMutationId: mutation.id }, {
        updateMetadata: async (targetExtensionId, input) => await extensionSdk.updateExtensionMetadata(targetExtensionId, input),
        setIcon: async (targetExtensionId, file) => await extensionSdk.setExtensionIcon(targetExtensionId, file),
      })
      const nextItem = applyEditedMyExtension(item, result.extension)
      setMyExtensions(current => current.map(candidate => candidate.ownedRef === item.ownedRef
        ? applyEditedMyExtension(candidate, result.extension)
        : candidate))
      setDiscoverItems(current => current.map(candidate => candidate.extension_id === extensionId
        ? { ...candidate, ...result.extension }
        : candidate))
      setPublishedItems(current => current.some(candidate => candidate.extension_id === extensionId)
        ? current.map(candidate => candidate.extension_id === extensionId ? { ...candidate, ...result.extension } : candidate)
        : [result.extension, ...current])
      setDetail(current => current?.extension_id === extensionId ? { ...current, ...result.extension } : current)
      setEditItem(nextItem)
      await load('mine', 'refresh')
      if (result.kind === 'metadata-saved-icon-failed') {
        setEditError(`资料已保存，但头像更新失败：${result.error}`)
        return
      }
      editMutation.current = undefined
      setEditItem(undefined)
      setRestartNotice('扩展信息已更新。')
    } catch (caught) {
      await load('mine', 'refresh')
      setEditError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setEditBusy(false)
    }
  }

  const copyShareLink = async () => {
    if (detail?.share === undefined) return
    try {
      await navigator.clipboard.writeText(detail.share.url)
      setShareNotice('链接已复制')
    } catch {
      setShareNotice('复制失败，请重试')
    }
  }

  useEffect(() => {
    if (shareNotice === '') return
    const timer = window.setTimeout(() => { setShareNotice('') }, 1800)
    return () => { window.clearTimeout(timer) }
  }, [shareNotice])

  const openAuthorPrivateChat = async () => {
    if (detail?.owner_user_id === undefined || authorActionBusy) return
    setAuthorActionBusy(true); setAuthorActionError('')
    try {
      const result = await callArkme<ArkmeOpenPrivateChatResult>('chat.private.open', {
        peerUserId: detail.owner_user_id,
        displayName: extensionCommunityAuthor(detail).name,
      })
      onPrivateChatOpened?.(result.source)
      setAuthorCardOpen(false)
    } catch (caught) {
      setAuthorActionError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setAuthorActionBusy(false)
    }
  }

  const openAuthorWorld = () => {
    if (detail === undefined) return
    const target = extensionAuthorWorldTarget(detail)
    if (target === undefined) return
    setAuthorCardOpen(false)
    closeDetail(false)
    arkmeUi.showUserWorld(target)
  }

  const openAuthorExtensions = () => {
    if (detail?.owner_user_id === undefined || !Number.isSafeInteger(detail.owner_user_id) || detail.owner_user_id <= 0) return
    setAuthorFilter({
      ownerUserId: detail.owner_user_id,
      ownerName: extensionCommunityAuthor(detail).name,
    })
    setCategory('all')
    setTab('discover')
    setAuthorCardOpen(false)
    closeDetail(false)
  }

  const updateCount = actionableExtensionUpdates(updates).length
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchesQuery = (name: string, description: string) => normalizedQuery === ''
    || name.toLocaleLowerCase().includes(normalizedQuery)
    || description.toLocaleLowerCase().includes(normalizedQuery)
  const visibleItems = (authorFilter === undefined
    ? mergeExtensionDiscoverItems(discoverItems, publishedItems)
    : discoverItems)
    .filter(item => matchesQuery(item.name, item.description))
  const visibleInstalled = installed.filter(item => matchesQuery(item.manifest.name, item.manifest.description))
  const visibleUpdates = actionableExtensionUpdates(updates).filter(item => {
    const local = installed.find(installedItem => installedItem.extensionId === item.extension_id)
    return matchesQuery(local?.manifest.name ?? item.extension_id, local?.manifest.description ?? '')
  })
  const iconRefFor = (extensionId: string): string | undefined => discoverItems.find(item => item.extension_id === extensionId)?.icon_ref
    ?? publishedItems.find(item => item.extension_id === extensionId)?.icon_ref
    ?? myExtensions.find(item => item.published?.extensionId === extensionId)?.published?.iconRef
  const busy = loadingTab === tab || sharedDetailBusy
  const detailModalOpen = detailRequestedExtensionId !== undefined || detail !== undefined
  const detailInstalled = detail === undefined ? undefined : installed.find(item => item.extensionId === detail.extension_id)
  const detailUpdate = detail === undefined ? undefined : updates.find(item => item.extension_id === detail.extension_id)
  const detailInstallAction = detail === undefined
    ? { label: '安装' as const, disabled: true }
    : tab === 'updates' && detailUpdate?.update_available === true && !detailUpdate.revoked
      ? { label: '更新' as const, disabled: false }
      : extensionCatalogAction(detail, detailInstalled?.installedVersion, tab === 'mine')
  const detailAction = detailInstallAction.label
  const detailUpdateAvailable = detailUpdate?.update_available === true
    && !detailUpdate.revoked && detailUpdate.latest_version !== undefined
  const detailPrimaryActionVisible = detailInstalled === undefined
    ? !detailInstallAction.disabled
    : detailUpdateAvailable
  const detailPrimaryActionLabel = detailUpdateAvailable && detailUpdate?.latest_version !== undefined
    ? '更新'
    : detailAction
  const detailTask = installTask?.extensionId === detail?.extension_id ? installTask : undefined
  const detailHasPreviews = extensionDetailHasPreviews(detail?.preview_images)
  const canDeleteDetail = detail !== undefined && tab === 'mine'
    && myExtensions.some(item => item.published?.extensionId === detail.extension_id)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (editItem !== undefined && !editBusy) { editMutation.current = undefined; setEditItem(undefined) }
      else if (publishItem !== undefined && !publishBusy) { publishMutation.current = undefined; setPublishItem(undefined) }
      else if (restartPrompt !== undefined && !restarting) setRestartPrompt(undefined)
      else if (authorCardOpen) setAuthorCardOpen(false)
      else if (detailModalOpen) closeDetail()
      else if (restartPrompt === undefined && displayMode === 'dialog') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [authorCardOpen, detailModalOpen, displayMode, editBusy, editItem, onClose, publishBusy, publishItem, restartPrompt, restarting])

  useEffect(() => {
    if (!detailModalOpen || typeof document === 'undefined') return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => { detailDialogRef.current?.focus() }, 0)
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = previousOverflow
    }
  }, [detailModalOpen])

  const renderTabNavigation = (inline: boolean) => <nav
    style={inline ? styles.marketPageTabs : styles.tabs}
    role="tablist"
    aria-label="市集页面导航"
    {...(inline ? { 'data-market-page-tabs': 'inline' } : {})}
  >
    {(Object.keys(TAB_LABELS) as Tab[]).map(value => <button
      key={value} type="button" role="tab" aria-selected={tab === value}
      style={{
        ...(inline ? styles.marketPageTab : styles.tab),
        ...(tab === value ? (inline ? styles.marketPageActiveNav : styles.activeTab) : {}),
      }}
      {...(inline ? { 'data-market-page-nav-state': tab === value ? 'selected' : 'idle' } : {})}
      onClick={() => { switchTab(value) }}
      onMouseEnter={event => {
        if (inline && tab !== value) event.currentTarget.style.background = colors.hover
      }}
      onMouseLeave={event => {
        if (inline && tab !== value) event.currentTarget.style.background = 'transparent'
      }}
    >
      <span style={inline
        ? styles.marketPageNavLabel
        : { ...styles.tabLabel, ...(tab === value ? styles.activeTabLabel : {}) }}>
        {TAB_LABELS[value]}
        {value === 'updates' && updateCount > 0 && <span style={{
          ...styles.count,
          ...(inline ? styles.marketPageNavCount : {}),
        }}>{updateCount}</span>}
      </span>
    </button>)}
  </nav>

  const dialog = <div style={displayMode === 'page' ? styles.pageBackdrop : styles.backdrop} onMouseDown={event => {
    if (displayMode === 'dialog' && event.target === event.currentTarget) onClose?.()
  }}>
  <section
    style={displayMode === 'page' ? styles.pageDialog : styles.dialog}
    {...(displayMode === 'dialog' ? { role: 'dialog', 'aria-modal': true } : { role: 'region' })}
    aria-labelledby="arkme-marketplace-title"
  >
  <div style={{ ...styles.shell, ...(displayMode === 'page' ? styles.pageShell : {}) }} aria-label="Arkme 市集">
    {displayMode === 'dialog' && <header style={styles.header}>
      <h2 id="arkme-marketplace-title" style={styles.title}>市集</h2>
      {detail?.share !== undefined && <button
        type="button"
        style={{ ...styles.iconButton, position: 'relative' }}
        aria-label="复制扩展链接"
        title="复制链接"
        onClick={() => { setShareNotice(''); void copyShareLink() }}
      ><LinkIcon />{shareNotice !== '' && <span role="status" style={styles.detailCopyNotice}>{shareNotice}</span>}</button>}
      <button
        type="button" style={styles.iconButton} aria-label="关闭市集" title="关闭"
        onClick={onClose}
        onMouseEnter={event => { event.currentTarget.style.background = colors.hover }}
        onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
      ><CloseIcon /></button>
    </header>}
    {displayMode === 'page' && <header style={styles.marketPageHeader} data-market-header-layer="primary">
      <h2 id="arkme-marketplace-title" style={styles.marketPageTitle}>市集</h2>
      {renderTabNavigation(true)}
    </header>}
    {displayMode === 'dialog' && renderTabNavigation(false)}
    {displayMode === 'page' && tab === 'discover' && <div style={styles.marketplaceToolbar} data-market-header-layer="secondary">
      <input
        value={searchQuery}
        onChange={event => { setSearchQuery(event.target.value) }}
        style={styles.searchBox}
        type="search"
        aria-label="搜索扩展、功能或作者"
        placeholder="搜索扩展、功能或作者…"
      />
      {authorFilter !== undefined && <span style={styles.marketplaceAuthorFilter} data-marketplace-author-filter="true">
        <span style={styles.marketplaceAuthorFilterLabel}>{authorFilter.ownerName === '我' ? '我的全部插件' : `${authorFilter.ownerName} 的全部插件`}</span>
        <button
          type="button"
          style={styles.marketplaceAuthorFilterClear}
          aria-label={`清除作者 ${authorFilter.ownerName} 筛选`}
          title="清除作者筛选"
          onClick={() => { setAuthorFilter(undefined) }}
        >×</button>
      </span>}
      <div style={styles.discoverControls}>
        <MarketplaceMenu
          ariaLabel="扩展分类"
          triggerLabel={`分类：${selectedCategoryName}`}
          value={category}
          options={categoryOptions}
          searchable
          searchPlaceholder="搜索扩展分类"
          emptySearchLabel="未找到相关分类"
          {...(classificationHint === undefined ? {} : { hint: classificationHint })}
          onChange={value => {
            setCategory(value)
            if (value !== 'all') setAuthorFilter(undefined)
          }}
        />
        <MarketplaceMenu
          ariaLabel="扩展排序"
          triggerLabel={`排序：${MARKET_SORTS.find(option => option.value === sort)?.label
            ?? MARKET_SORTS.find(option => option.value === DEFAULT_MARKETPLACE_SORT)?.label
            ?? '评分最高'}`}
          value={sort}
          options={MARKET_SORTS}
          available={sortingEnabled}
          unavailableHint="排序接口暂未同步，当前保持最新创建。"
          onChange={value => {
            setSort(value)
            writeMarketplaceSortPreference(currentUserId, value)
          }}
        />
      </div>
    </div>}
    <main
      ref={displayMode === 'page' ? discoverListRef : undefined}
      style={{ ...styles.list, ...(displayMode === 'page' ? { padding: '22px 32px 32px' } : {}) }}
      onScroll={event => {
        if (displayMode !== 'page' || tab !== 'discover') return
        const target = event.currentTarget
        if (shouldLoadMoreDiscoverPage(target)) void loadMoreDiscoverPage()
      }}
    >
      {error !== '' && <div style={styles.error}>{error}</div>}
      {installError !== '' && <div style={styles.error}>{installError}</div>}
      {installTask !== undefined && !installTask.done && <div style={styles.installStatus} role="status">
        {installTask.message}
        {installTask.phase === 'downloading' && installTask.downloadedBytes !== undefined
          ? ` · ${formatExtensionBytes(installTask.downloadedBytes)}${installTask.totalBytes === undefined ? '' : ` / ${formatExtensionBytes(installTask.totalBytes)}`}`
          : ''}
      </div>}
      {restartNotice !== '' && <div style={styles.restartNotice} role="status">{restartNotice}</div>}
      {tab === 'discover' && discoverOwnerWarning !== ''
        && <div style={styles.restartNotice} role="status">{discoverOwnerWarning}</div>}
      {tab === 'mine' && myExtensionWarningText(myExtensionWarnings) !== ''
        && <div style={styles.restartNotice} role="status">{myExtensionWarningText(myExtensionWarnings)}</div>}
      {busy && <LoadingState />}
      {!busy && error === '' && sharedDetail !== undefined && shareRef !== undefined && <SharedExtensionDetailView
        shareRef={shareRef}
        extension={sharedDetail}
        onBack={() => { setSharedDetail(undefined); onShareExit?.() }}
      />}
      {!busy && error === '' && sharedDetail === undefined && (displayMode === 'page' || detail === undefined) && tab === 'discover' && <>
        <div style={displayMode === 'page' ? styles.communityGrid : undefined} data-extension-grid={displayMode === 'page' ? 'compact-auto-fill-directory' : undefined}>
        {visibleItems.map(item => {
          const local = installed.find(installedItem => installedItem.extensionId === item.extension_id)
          const action = extensionCatalogAction(item, local?.installedVersion)
          return <ExtensionCard
            key={item.extension_id}
            item={item}
            presentation={displayMode === 'page' ? 'community' : 'list'}
            {...(local === undefined || action.label === '更新' ? { actionLabel: action.label } : {})}
            {...(local === undefined ? {} : { installed: local })}
            installTask={installTask?.extensionId === item.extension_id ? installTask : undefined}
            actionBusy={actionBusyExtensionId === item.extension_id}
            onClick={() => { void inspect(item.extension_id) }}
            {...(action.disabled || (installTask !== undefined && !installTask.done)
              ? {}
              : { onAction: () => { void startInstall(extensionDirectInstallTarget(item)) } })}
            {...(local === undefined ? {} : { onToggle: (enabled: boolean) => { void toggleEnabled(item.extension_id, enabled) } })}
            onPause={() => { void controlInstall('extensions.install.pause') }}
            onResume={() => { void controlInstall('extensions.install.resume') }}
          />
        })}
        </div>
        {loadingMoreDiscover && <div role="status" style={styles.marketplaceLoadingMore}>
          <LoadingIcon />正在加载更多…
        </div>}
        {!loadingMoreDiscover && loadMoreDiscoverError !== '' && <div role="alert" style={styles.marketplaceLoadMoreRetry}>
          <span>加载更多失败</span>
          <button type="button" style={styles.marketplaceRetryButton} onClick={() => { void loadMoreDiscoverPage() }}>重试</button>
        </div>}
        {visibleItems.length === 0 && (authorFilter === undefined
          ? <EmptyState tab={tab} />
          : <div style={styles.empty} data-marketplace-author-empty="true">
              <span style={styles.emptyIcon}><ArkmeExtensionIcon size={22} /></span>
              <span style={styles.emptyTitle}>暂无插件</span>
              <span style={styles.emptyDesc}>该作者暂未发布公开插件</span>
            </div>)}
      </>}
      {!busy && error === '' && sharedDetail === undefined && (displayMode === 'page' || detail === undefined) && tab === 'mine' && <>
        {myExtensions.map(item => {
          const extensionId = item.published?.extensionId
          const local = extensionId === undefined ? undefined : installed.find(candidate => candidate.extensionId === extensionId)
          return <MyExtensionCard
            key={item.ownedRef}
            item={item}
            {...(local === undefined ? {} : {
              installed: local,
              toggleBusy: actionBusyExtensionId === extensionId,
              onToggle: (enabled: boolean) => { void toggleEnabled(extensionId!, enabled) },
            })}
            onPublish={() => { publishMutation.current = undefined; setPublishError(''); setPublishItem(item) }}
            onEdit={() => {
              editMutation.current = undefined; setEditError('')
              setEditItem(item)
            }}
			onOpen={() => {
				const published = item.published
				if (published === undefined) return
				if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) detailReturnFocus.current = document.activeElement
				setDetailRequestedExtensionId(published.extensionId); setDetailError(''); setShareNotice('')
				setDetail({
					extension_id: published.extensionId,
					name: item.name,
					description: item.description,
					visibility: published.visibility,
					...(published.version === undefined ? {} : { version: published.version, latest_stable_version: published.version }),
					...(published.iconRef === undefined ? {} : { icon_ref: published.iconRef }),
					...(published.previewImages === undefined ? {} : { preview_images: published.previewImages }),
					...(published.previewRevision === undefined ? {} : { preview_revision: published.previewRevision }),
					...(published.source === undefined ? {} : { source: published.source }),
					...(published.share === undefined ? {} : { share: published.share }),
				})
			}}
          />
        })}
        {myExtensions.length === 0 && <EmptyState tab="mine" />}
      </>}
      {!busy && error === '' && sharedDetail === undefined && detail === undefined && tab === 'installed' && <>
        <div style={styles.lifecycleList} data-extension-lifecycle-list="installed">
          {visibleInstalled.map(item => <ArkmeExtensionLifecycleRow
            key={item.extensionId}
            item={mergeInstalledExtensionCatalogItem(
              item, lifecycleCatalogItems[item.extensionId], iconRefFor(item.extensionId),
            )}
            installed={item}
            kind="installed"
            actionBusy={actionBusyExtensionId === item.extensionId}
            onOpen={() => { void inspect(item.extensionId) }}
            onToggle={enabled => { void toggleEnabled(item.extensionId, enabled) }}
          />)}
        </div>
        {visibleInstalled.length === 0 && <EmptyState tab="installed" />}
      </>}
      {!busy && error === '' && sharedDetail === undefined && detail === undefined && tab === 'updates' && <>
        <div style={styles.lifecycleList} data-extension-lifecycle-list="updates">
        {visibleUpdates.map(item => {
          const local = installed.find(installedItem => installedItem.extensionId === item.extension_id)
          if (local === undefined) return null
          const catalogItem = mergeInstalledExtensionCatalogItem(
            local, lifecycleCatalogItems[item.extension_id], iconRefFor(item.extension_id),
          )
          const canAct = installTask === undefined || installTask.done
          return <ArkmeExtensionLifecycleRow
            key={item.extension_id}
            item={catalogItem}
            installed={local}
            kind="update"
            actionBusy={actionBusyExtensionId === item.extension_id}
            installTask={installTask?.extensionId === item.extension_id ? installTask : undefined}
            onOpen={() => { void inspect(item.extension_id) }}
            {...(!canAct || !item.update_available || item.revoked ? {} : { onUpdate: () => {
              void startInstall({
                extensionId: item.extension_id,
                ...(item.latest_version === undefined ? {} : { version: item.latest_version }),
              })
            } })}
            onPause={() => { void controlInstall('extensions.install.pause') }}
            onResume={() => { void controlInstall('extensions.install.resume') }}
          />
        })}
        </div>
        {visibleUpdates.length === 0 && <EmptyState tab="updates" />}
      </>}
    </main>
    {detailModalOpen && <div
      style={styles.detailModalBackdrop}
      data-extension-detail-backdrop="true"
      onMouseDown={event => {
        if (event.target === event.currentTarget && actionBusyExtensionId === undefined && !detailBusy) closeDetail()
      }}
    >
      <section
        ref={detailDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="arkme-extension-detail-title"
        tabIndex={-1}
        style={styles.detailModal}
        data-extension-detail-modal="true"
        onKeyDown={event => {
          if (event.key !== 'Tab') return
          const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
            .filter(element => element.offsetParent !== null)
          const first = focusable[0]
          const last = focusable.at(-1)
          if (first === undefined || last === undefined) { event.preventDefault(); return }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }}
      >
        <ArkmeExtensionDetailHeader
          title={detail?.name ?? '扩展详情'}
          copyAvailable={detail?.share !== undefined}
          copyNotice={shareNotice}
          onCopy={() => { setShareNotice(''); void copyShareLink() }}
          onClose={() => { closeDetail() }}
        />
        <div style={styles.detailModalBody}>
          {detailBusy && <div style={styles.detailModalState} aria-label="正在加载扩展详情"><LoadingState /></div>}
          {!detailBusy && detailError !== '' && <div style={styles.detailModalState} role="alert">
            <div>
              <div>{detailError}</div>
              <div style={styles.detailModalErrorActions}>
                <button type="button" style={styles.restartLater} onClick={() => { closeDetail() }}>关闭</button>
                {detailRequestedExtensionId !== undefined && <button
                  type="button" style={styles.primaryButton}
                  onClick={() => { void inspect(detailRequestedExtensionId) }}
                >重新加载</button>}
              </div>
            </div>
          </div>}
          {!detailBusy && detailError === '' && detail !== undefined && <div style={styles.detail}>
            {installError !== '' && <div style={styles.error} role="alert">{installError}</div>}
            {restartNotice !== '' && <div style={styles.restartNotice} role="status">{restartNotice}</div>}
            {detailTask !== undefined && !detailTask.done && <div style={styles.installStatus} role="status">{detailTask.message}</div>}

            <div style={{ ...styles.detailLead, ...(detailHasPreviews ? {} : styles.detailLeadWithoutPreview) }} data-detail-has-preview={detailHasPreviews ? 'true' : 'false'}>
              <div style={styles.detailIdentity}>
                <div style={styles.detailHero}>
                  <ArkmeExtensionAvatar extensionId={detail.extension_id} iconRef={detail.icon_ref} size={58} />
                  <div style={styles.cardBody}>
                    <div style={styles.detailTitleRow}>
                      <h3 style={styles.detailName}>{detail.name}</h3>
                      {(detailInstalled !== undefined || detailPrimaryActionVisible) && <div
                        style={styles.detailTitleActions}
                        data-extension-lifecycle-actions="title"
                      >
                        {detailPrimaryActionVisible && ((detailTask !== undefined && !detailTask.done)
                          || actionBusyExtensionId === detail.extension_id
                          ? <InstallLoadingButton
                              task={detailTask}
                              onPause={() => { void controlInstall('extensions.install.pause') }}
                              onResume={() => { void controlInstall('extensions.install.resume') }}
                            />
                          : <button
                              type="button" style={styles.primaryButton} disabled={actionBusyExtensionId === detail.extension_id}
                              onClick={() => {
                                if (detailUpdateAvailable && detailUpdate?.latest_version !== undefined) {
                                  void startInstall({ extensionId: detail.extension_id, version: detailUpdate.latest_version })
                                } else void startInstall(extensionDirectInstallTarget(detail))
                              }}
                            >{detailPrimaryActionLabel}</button>)}
                        {detailInstalled !== undefined && <div style={styles.detailEnabledControl}>
                          <span>{extensionEnabledLabel(detailInstalled)}</span>
                          <ArkmeExtensionToggle
                            item={detailInstalled}
                            busy={actionBusyExtensionId === detail.extension_id}
                            onChange={enabled => { void toggleEnabled(detail.extension_id, enabled) }}
                          />
                        </div>}
                      </div>}
                    </div>
                    <ArkmeExtensionDetailMetrics item={detail} />
                    <ArkmeExtensionAuthorPopover
                      item={detail}
                      open={authorCardOpen}
                      currentUserId={currentUserId}
                      actionBusy={authorActionBusy}
                      actionError={authorActionError}
                      style={{ marginTop: 10 }}
                      onToggle={() => { setAuthorCardOpen(value => !value); setAuthorActionError('') }}
                      onPrivateChat={() => { void openAuthorPrivateChat() }}
                      onOtherExtensions={openAuthorExtensions}
                      onWorld={openAuthorWorld}
                    />
                    {detailPrimaryActionVisible && <div style={styles.detailAuditAction}>
                      <ArkmeExtensionAuditAction
                        extensionId={detail.extension_id}
                        busyExtensionId={auditBusyExtensionId}
                        onRun={extensionId => { void runAudit(extensionId) }}
                      />
                    </div>}
                  </div>
                </div>
                {detailInstallAction.disabled && detailInstalled === undefined && <div style={styles.detailHint}>该扩展的制品上传或发布尚未完成，目前没有可安装版本。</div>}
              </div>
              {detailHasPreviews && <div style={styles.detailPreview}>
                <ArkmeExtensionPreviewGallery
                  key={detail.extension_id}
                  extensionId={detail.extension_id}
                  extensionName={detail.name}
                  previews={detail.preview_images ?? []}
                />
              </div>}
            </div>

            <ArkmeExtensionAuditFeedback error={auditError} result={auditResult} />

            <div style={styles.detailColumns}>
              <div style={styles.detailAbout}>
                <h3 style={styles.detailSectionTitle}>关于</h3>
                <div style={{ ...styles.detailValue, marginTop: 0, whiteSpace: 'pre-wrap' }}>{detail.description || '这个扩展还没有填写说明。'}</div>
                <ArkmeExtensionManifestDetails manifest={detail.manifest} />
              </div>
              <aside style={styles.detailFacts} aria-label="扩展详细信息">
                <h3 style={styles.detailSectionTitle}>详情</h3>
                {detailInstalled !== undefined && <section style={styles.detailSection}><div style={styles.detailLabel}>已安装版本</div><div style={styles.detailValue}>{displayVersion(detailInstalled.installedVersion)}</div></section>}
                {(detailUpdate?.latest_version ?? detail.version ?? detail.latest_stable_version) !== undefined && <section style={styles.detailSection}><div style={styles.detailLabel}>市场最新版本</div><div style={styles.detailValue}>{displayVersion(detailUpdate?.latest_version ?? detail.version ?? detail.latest_stable_version)}</div></section>}
                {detail.created_at !== undefined && formatMarketplaceDate(detail.created_at) !== '' && <section style={styles.detailSection}><div style={styles.detailLabel}>创建时间</div><div style={styles.detailValue}>{formatMarketplaceDate(detail.created_at)}</div></section>}
                {detail.source !== undefined && <section style={styles.detailSection}>
                  <div style={styles.detailLabel}>来源</div>
                  <div style={styles.detailValue}><ArkmeExtensionSourceLink source={detail.source} /></div>
                </section>}
                {(detailInstalled !== undefined || canDeleteDetail) && <div style={styles.detailDangerZone} aria-label="扩展危险操作">
                  {detailInstalled !== undefined && (uninstallConfirmExtensionId === detail.extension_id
                    ? <div style={styles.detailConfirm} role="alert">
                      卸载只删除当前设备中的扩展制品和 Profile 依赖；如果只是暂时不使用，请关闭上方开关。
                      <div style={styles.detailConfirmActions}>
                        <button type="button" style={styles.restartLater} onClick={() => { setUninstallConfirmExtensionId(undefined) }}>取消</button>
                        <button type="button" style={{ ...styles.detailDanger, marginTop: 0 }} disabled={actionBusyExtensionId === detail.extension_id} onClick={() => { void uninstall(detail.extension_id) }}>确认卸载</button>
                      </div>
                    </div>
                    : <button
                      type="button" style={styles.detailDanger} disabled={actionBusyExtensionId === detail.extension_id}
                      onClick={() => { setDeleteConfirmExtensionId(undefined); setUninstallConfirmExtensionId(detail.extension_id) }}
                    >卸载本地扩展</button>)}
                  {canDeleteDetail && (deleteConfirmExtensionId === detail.extension_id
                    ? <div style={styles.detailConfirm} role="alert">
                      删除会将这个扩展从市集中移除，但不会自动卸载当前设备中的本地副本。
                      <div style={styles.detailConfirmActions}>
                        <button type="button" style={styles.restartLater} onClick={() => { setDeleteConfirmExtensionId(undefined) }}>取消</button>
                        <button type="button" style={{ ...styles.detailDanger, marginTop: 0 }} disabled={actionBusyExtensionId === detail.extension_id} onClick={() => { void deletePublishedExtension(detail.extension_id) }}>确认删除</button>
                      </div>
                    </div>
                    : <button
                      type="button" style={styles.detailDanger} disabled={actionBusyExtensionId === detail.extension_id}
                      onClick={() => { setUninstallConfirmExtensionId(undefined); setDeleteConfirmExtensionId(detail.extension_id) }}
                    >删除市集扩展</button>)}
                </div>}
              </aside>
            </div>

            {detail.visibility === 'public' && <ArkmeExtensionReviews
              extensionId={detail.extension_id}
              {...(currentUserAvatarRef === undefined ? {} : { currentUserAvatarRef })}
              canCreateTopLevelReview={detail.owner_user_id === undefined || detail.owner_user_id !== currentUserId}
              {...(detail.rating_summary === undefined ? {} : { initialRatingSummary: detail.rating_summary })}
            />}
          </div>}
        </div>
      </section>
    </div>}
    {restartPrompt !== undefined && <ArkmeExtensionRestartDialog
      kind={restartPrompt.kind}
      restarting={restarting}
      onLater={() => { setRestartPrompt(undefined) }}
      onRestart={() => { void restartNow() }}
    />}
    {publishItem !== undefined && <ArkmeExtensionPublishDialog
      item={publishItem}
      busy={publishBusy}
      error={publishError}
      onCancel={() => { if (!publishBusy) { publishMutation.current = undefined; setPublishItem(undefined) } }}
      onSubmit={value => { void publishMyExtension(publishItem, value) }}
    />}
    {editItem !== undefined && <ArkmeExtensionEditDialog
      item={editItem}
      busy={editBusy}
      error={editError}
      onCancel={() => { if (!editBusy) { editMutation.current = undefined; setEditItem(undefined) } }}
      onSubmit={value => { void saveMyExtensionEdit(editItem, value) }}
    />}
  </div>
  </section>
  </div>

  if (displayMode === 'page' || typeof document === 'undefined') return dialog
  return createPortal(dialog, document.body)
}

export { ArkmeExtensionPreviewGallery, arkmeExtensionPreviewUrl, extensionPreviewSelection } from './ArkmeExtensionPreviewGallery.js'
