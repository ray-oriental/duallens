import { t } from '../shared/i18n.js';

// An empty binding is intentional. Never replace it with the manifest default.
export function shortcutFor(commands, name) {
  return commands.find(command => command.name === name)?.shortcut?.trim() || '';
}

export function shortcutSummary(commands) {
  return [['toggle-page', 'm4c'], ['toggle-translation-only', 'uxSwitchDisplay'],
    ['translate-input', 'polishInputShort'], ['open-sidepanel', 'ma6']]
    .map(([name, key]) => {
      const binding = shortcutFor(commands, name);
      return binding ? t('lookShortcut', [t(key), binding]) : '';
    }).filter(Boolean).join(' · ');
}
