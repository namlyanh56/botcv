const actions = {
  START_TXT_TO_VCF: 'action:txt_to_vcf:start',
  START_VCF_TO_TXT: 'action:vcf_to_txt:start',
  START_SPLIT_FILE: 'action:split_file:start',
  START_ADMIN_FROM_MESSAGE: 'action:admin_from_message:start',
  START_MERGE_FILES: 'action:merge_files:start',
  START_XLSX_TO_VCF: 'action:xlsx_to_vcf:start',

  MERGE_DONE: 'action:merge_files:done',

  // Reuse filename choices
  FILENAME_CUSTOM: 'action:txt_to_vcf:filename_custom',
  FILENAME_DEFAULT: 'action:txt_to_vcf:filename_default',

  // Split mode
  SPLIT_MODE_CONTACTS: 'action:split_file:mode_contacts',
  SPLIT_MODE_FILES: 'action:split_file:mode_files',

  CANCEL: 'action:cancel',
};

function getMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📒TXT to VCF📒', callback_data: actions.START_TXT_TO_VCF }],
        [{ text: '📗VCF to TXT📗', callback_data: actions.START_VCF_TO_TXT }],
        [{ text: '📂Pecah File📂', callback_data: actions.START_SPLIT_FILE }],
        [{ text: '👤CV Admin👤', callback_data: actions.START_ADMIN_FROM_MESSAGE }],
        [{ text: '🗃️Gabung File🗃️', callback_data: actions.START_MERGE_FILES }],
        [{ text: '🧩XLSX to VCF🧩', callback_data: actions.START_XLSX_TO_VCF }],
      ],
    },
  };
}

function getCancelMenu() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: 'Batal', callback_data: actions.CANCEL }]],
    },
  };
}

function getFilenameChoiceMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Custom', callback_data: actions.FILENAME_CUSTOM },
          { text: 'Default', callback_data: actions.FILENAME_DEFAULT },
        ],
        [{ text: 'Batal', callback_data: actions.CANCEL }],
      ],
    },
  };
}

function getSplitModeMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Jumlah CTC👥', callback_data: actions.SPLIT_MODE_CONTACTS },
          { text: 'Jumlah File📚', callback_data: actions.SPLIT_MODE_FILES },
        ],
        [{ text: 'Batal', callback_data: actions.CANCEL }],
      ],
    },
  };
}

// Inline keyboard khusus pengumpulan file untuk fitur Gabung File
function getMergeCollectMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Selesai', callback_data: actions.MERGE_DONE }],
        [{ text: '✖️ Batal', callback_data: actions.CANCEL }],
      ],
    },
  };
}

module.exports = {
  actions,
  getMainMenu,
  getCancelMenu,
  getFilenameChoiceMenu,
  getSplitModeMenu,
  getMergeCollectMenu,
};
