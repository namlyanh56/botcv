const actions = {
  START_TXT_TO_VCF: 'action:txt_to_vcf:start',
  START_VCF_TO_TXT: 'action:vcf_to_txt:start',
  START_SPLIT_FILE: 'action:split_file:start',
  START_ADMIN_FROM_MESSAGE: 'action:admin_from_message:start',
  START_MERGE_FILES: 'action:merge_files:start',
  START_XLSX_TO_VCF: 'action:xlsx_to_vcf:start',
  START_RENAME: 'action:rename:start',

  // Rename mode
  RENAME_MODE_FILE: 'action:rename:mode_file',
  RENAME_MODE_CTC: 'action:rename:mode_ctc',

  MERGE_DONE: 'action:merge_files:done',

  // Reuse filename choices
  FILENAME_CUSTOM: 'action:txt_to_vcf:filename_custom',
  FILENAME_DEFAULT: 'action:txt_to_vcf:filename_default',

  // Split mode
  SPLIT_MODE_CONTACTS: 'action:split_file:mode_contacts',
  SPLIT_MODE_FILES: 'action:split_file:mode_files',

  // Trial
  START_TRIAL: 'action:trial:start',

  CANCEL: 'action:cancel',
};

// Label untuk Reply Keyboard Menu Utama (agar konsisten di index.js)
const menuLabels = {
  TXT_TO_VCF: '💎 TXT to VCF 💎',
  XLSX_TO_VCF: '🧩 XLSX to VCF 🧩',
  VCF_TO_TXT: '📮 VCF to TXT 📮',
  ADMIN_FROM_MSG: '👤 CV Admin 👤',
  SPLIT_FILE: '✂️ Pecah File ✂️',
  MERGE_FILES: '🔗 Gabung File 🔗',
  RENAME: '⚡ Rename ⚡',
  STOP: '⛔ Stop ⛔',
};

// MENU UTAMA: Reply Keyboard (persisten di bawah kolom chat)
function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        // Fitur convert berdekatan
        [{ text: menuLabels.TXT_TO_VCF }, { text: menuLabels.XLSX_TO_VCF }],
        [{ text: menuLabels.VCF_TO_TXT }, { text: menuLabels.ADMIN_FROM_MSG }],
        // Pecah dan Gabung bersandingan
        [{ text: menuLabels.SPLIT_FILE }, { text: menuLabels.MERGE_FILES }],
        // Tambahan
        [{ text: menuLabels.RENAME }, { text: menuLabels.STOP }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      is_persistent: true,
    },
  };
}

// Tetap gunakan inline untuk langkah-langkah lanjutan
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

// Inline keyboard untuk memilih mode rename
function getRenameModeMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Rename File📂', callback_data: actions.RENAME_MODE_FILE },
          { text: 'Rename CTC👤', callback_data: actions.RENAME_MODE_CTC },
        ],
        [{ text: 'Batal', callback_data: actions.CANCEL }],
      ],
    },
  };
}

// Inline keyboard ketika akses ditolak: tawarkan trial
function getTrialMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎁 Uji coba 🎁', callback_data: actions.START_TRIAL }],
      ],
    },
  };
}

module.exports = {
  actions,
  menuLabels,
  getMainMenu,
  getCancelMenu,
  getFilenameChoiceMenu,
  getSplitModeMenu,
  getMergeCollectMenu,
  getRenameModeMenu,
  getTrialMenu,
};
