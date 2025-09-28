// Minimal inline keyboard builders

const actions = {
  START_TXT_TO_VCF: 'action:txt_to_vcf:start',
  FILENAME_CUSTOM: 'action:txt_to_vcf:filename_custom',
  FILENAME_DEFAULT: 'action:txt_to_vcf:filename_default',
  CANCEL: 'action:cancel',
};

function getMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📒TXT to VCF📒', callback_data: actions.START_TXT_TO_VCF }],
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

module.exports = {
  actions,
  getMainMenu,
  getCancelMenu,
  getFilenameChoiceMenu,
};
