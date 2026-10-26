import { t } from '../../shared/i18n.js';
import { terms } from '../validation.js';

// Validate before replacing a draft or offering it as a downloadable file.
export function parseGlossary(text) {
  const glossary = terms(text);
  if (glossary.length > 500) throw new Error(t('mjm'));
  return glossary;
}

export function formatGlossary(glossary) {
  return glossary.map(({src, dst}) => `${src}\t${dst}`).join('\n');
}
