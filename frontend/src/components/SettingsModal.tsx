import { useState, useEffect, type ReactNode } from 'react';
import type {
  AppSettings,
  AppSettingsUpdate,
  HealthStatus,
  RadioConfig,
  RadioConfigUpdate,
} from '../types';
import type { LocalLabel } from '../utils/localLabel';
import { SETTINGS_SECTION_LABELS, type SettingsSection } from './settings/settingsConstants';

import { SettingsRadioSection } from './settings/SettingsRadioSection';
import { SettingsIdentitySection } from './settings/SettingsIdentitySection';
import { SettingsConnectivitySection } from './settings/SettingsConnectivitySection';
import { SettingsMqttSection } from './settings/SettingsMqttSection';
import { SettingsDatabaseSection } from './settings/SettingsDatabaseSection';
import { SettingsBotSection } from './settings/SettingsBotSection';
import { SettingsStatisticsSection } from './settings/SettingsStatisticsSection';
import { SettingsAboutSection } from './settings/SettingsAboutSection';

interface SettingsModalBaseProps {
  open: boolean;
  pageMode?: boolean;
  config: RadioConfig | null;
  health: HealthStatus | null;
  appSettings: AppSettings | null;
  onClose: () => void;
  onSave: (update: RadioConfigUpdate) => Promise<void>;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  onSetPrivateKey: (key: string) => Promise<void>;
  onReboot: () => Promise<void>;
  onAdvertise: () => Promise<void>;
  onHealthRefresh: () => Promise<void>;
  onRefreshAppSettings: () => Promise<void>;
  onLocalLabelChange?: (label: LocalLabel) => void;
  blockedKeys?: string[];
  blockedNames?: string[];
  onToggleBlockedKey?: (key: string) => void;
  onToggleBlockedName?: (name: string) => void;
}

type SettingsModalProps = SettingsModalBaseProps &
  (
    | { externalSidebarNav: true; desktopSection: SettingsSection }
    | { externalSidebarNav?: false; desktopSection?: never }
  );

export function SettingsModal(props: SettingsModalProps) {
  const {
    open,
    pageMode = false,
    config,
    health,
    appSettings,
    onClose,
    onSave,
    onSaveAppSettings,
    onSetPrivateKey,
    onReboot,
    onAdvertise,
    onHealthRefresh,
    onRefreshAppSettings,
    onLocalLabelChange,
    blockedKeys,
    blockedNames,
    onToggleBlockedKey,
    onToggleBlockedName,
  } = props;
  const externalSidebarNav = props.externalSidebarNav === true;
  const desktopSection = props.externalSidebarNav ? props.desktopSection : undefined;

  const getIsMobileLayout = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  };

  const [isMobileLayout, setIsMobileLayout] = useState(getIsMobileLayout);
  const externalDesktopSidebarMode = externalSidebarNav && !isMobileLayout;
  const [expandedSections, setExpandedSections] = useState<Record<SettingsSection, boolean>>(() => {
    const isMobile = getIsMobileLayout();
    return {
      radio: !isMobile,
      identity: false,
      connectivity: false,
      mqtt: false,
      database: false,
      bot: false,
      statistics: false,
      about: false,
    };
  });

  // Refresh settings from server when modal opens
  useEffect(() => {
    if (open || pageMode) {
      onRefreshAppSettings();
    }
  }, [open, pageMode, onRefreshAppSettings]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(max-width: 767px)');
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobileLayout(event.matches);
    };

    setIsMobileLayout(query.matches);

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }

    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  // On mobile with external sidebar nav, auto-expand the selected section
  useEffect(() => {
    if (!externalSidebarNav || !isMobileLayout || !desktopSection) return;
    setExpandedSections((prev) =>
      prev[desktopSection] ? prev : { ...prev, [desktopSection]: true }
    );
  }, [externalSidebarNav, isMobileLayout, desktopSection]);

  const toggleSection = (section: SettingsSection) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const isSectionVisible = (section: SettingsSection) =>
    externalDesktopSidebarMode ? desktopSection === section : expandedSections[section];

  const showSectionButton = !externalDesktopSidebarMode;
  const shouldRenderSection = (section: SettingsSection) =>
    !externalDesktopSidebarMode || desktopSection === section;

  const sectionWrapperClass = 'overflow-hidden';

  const sectionContentClass = externalDesktopSidebarMode
    ? 'space-y-4 p-4'
    : 'space-y-4 p-4 border-t border-input';

  const settingsContainerClass = externalDesktopSidebarMode
    ? 'w-full h-full overflow-y-auto'
    : 'w-full h-full overflow-y-auto space-y-3';

  const sectionButtonClasses =
    'w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

  const renderSectionHeader = (section: SettingsSection): ReactNode => {
    if (!showSectionButton) return null;
    return (
      <button
        type="button"
        className={sectionButtonClasses}
        aria-expanded={expandedSections[section]}
        onClick={() => toggleSection(section)}
      >
        <span className="font-medium" role="heading" aria-level={3}>
          {SETTINGS_SECTION_LABELS[section]}
        </span>
        <span className="text-muted-foreground md:hidden" aria-hidden="true">
          {expandedSections[section] ? '−' : '+'}
        </span>
      </button>
    );
  };

  if (!pageMode && !open) {
    return null;
  }

  return !config ? (
    <div className="py-8 text-center text-muted-foreground">Loading configuration...</div>
  ) : (
    <div className={settingsContainerClass}>
      {shouldRenderSection('radio') && (
        <section className={sectionWrapperClass}>
          {renderSectionHeader('radio')}
          {isSectionVisible('radio') && (
            <SettingsRadioSection
              config={config}
              pageMode={pageMode}
              onSave={onSave}
              onReboot={onReboot}
              onClose={onClose}
              className={sectionContentClass}
            />
          )}
        </section>
      )}

      {shouldRenderSection('identity') && (
        <section className={sectionWrapperClass}>
          {renderSectionHeader('identity')}
          {isSectionVisible('identity') && appSettings && (
            <SettingsIdentitySection
              config={config}
              health={health}
              appSettings={appSettings}
              pageMode={pageMode}
              onSave={onSave}
              onSaveAppSettings={onSaveAppSettings}
              onSetPrivateKey={onSetPrivateKey}
              onReboot={onReboot}
              onAdvertise={onAdvertise}
              onClose={onClose}
              className={sectionContentClass}
            />
          )}
        </section>
      )}

      {shouldRenderSection('connectivity') && (
        <section className={sectionWrapperClass}>
          {renderSectionHeader('connectivity')}
          {isSectionVisible('connectivity') && appSettings && (
            <SettingsConnectivitySection
              appSettings={appSettings}
              health={health}
              pageMode={pageMode}
              onSaveAppSettings={onSaveAppSettings}
              onReboot={onReboot}
              onClose={onClose}
              className={sectionContentClass}
            />
          )}
        </section>
      )}

      {shouldRenderSection('database') && (
        <section className={sectionWrapperClass}>
          {renderSectionHeader('database')}
          {isSectionVisible('database') && appSettings && (
            <SettingsDatabaseSection
              appSettings={appSettings}
              health={health}
              onSaveAppSettings={onSaveAppSettings}
              onHealthRefresh={onHealthRefresh}
              onLocalLabelChange={onLocalLabelChange}
              blockedKeys={blockedKeys}
              blockedNames={blockedNames}
              onToggleBlockedKey={onToggleBlockedKey}
              onToggleBlockedName={onToggleBlockedName}
              className={sectionContentClass}
            />
          )}
        </section>
      )}

      {shouldRenderSection('bot') && (
        <section className={sectionWrapperClass}>
          {renderSectionHeader('bot')}
          {isSectionVisible('bot') && appSettings && (
            <SettingsBotSection
              appSettings={appSettings}
              health={health}
              isMobileLayout={isMobileLayout}
              onSaveAppSettings={onSaveAppSettings}
              className={sectionContentClass}
            />
          )}
        </section>
      )}

      {shouldRenderSection('mqtt') && (
        <section className={sectionWrapperClass}>
          {renderSectionHeader('mqtt')}
          {isSectionVisible('mqtt') && appSettings && (
            <SettingsMqttSection
              appSettings={appSettings}
              health={health}
              onSaveAppSettings={onSaveAppSettings}
              className={sectionContentClass}
            />
          )}
        </section>
      )}

      {shouldRenderSection('statistics') && (
        <section className={sectionWrapperClass}>
          {renderSectionHeader('statistics')}
          {isSectionVisible('statistics') && (
            <SettingsStatisticsSection className={sectionContentClass} />
          )}
        </section>
      )}

      {shouldRenderSection('about') && (
        <section className={sectionWrapperClass}>
          {renderSectionHeader('about')}
          {isSectionVisible('about') && <SettingsAboutSection className={sectionContentClass} />}
        </section>
      )}
    </div>
  );
}
