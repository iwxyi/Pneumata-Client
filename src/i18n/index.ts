import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './zh.json';
import en from './en.json';
import { scopedStorageKey } from '../constants/brand';

const savedLang = localStorage.getItem(scopedStorageKey('language')) || 'zh';

function getDocumentTitle(language: string) {
  return language.startsWith('zh') ? '生息：Pneumata' : 'Pneumata';
}

function updateDocumentTitle(language: string) {
  document.title = getDocumentTitle(language);
}

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: 'zh',
  interpolation: {
    escapeValue: false,
  },
});

updateDocumentTitle(savedLang);
i18n.on('languageChanged', updateDocumentTitle);

export default i18n;
