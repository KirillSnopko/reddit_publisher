const SOURCE = { REDDIT: "reddit", VK: 'vk' };
const MEDIA_TYPE = { IMAGE: 'image', VIDEO: 'video' };
const lastIndexDir = './last_index';
const lastIndexSuff = '_last_index.txt';
const downloadDirectoryBase = './downloads';

const VK_TOKEN = process.env.VK_TOKEN??"vk1.a.Fxqcdk7KBgZFEj76PWHB-ih0dxaQZNxc8uQfL0dB-w4BMre2XSmSv-eAAAODTObtXzcL1qnEk2pVJTS1I219spMycnbAGUGZuxFUReUDW84UcNVP_ZPXrT98FXjFj26_EE-hS7d_tAuSGPWSqaIufJO8oy2oQg4DgZcdyXuQ8WU4OTUVz0FYkk7iRdQs1dSHDlwjWNe6NTDH5a6xju3hZw";
const BOT_TOKEN = process.env.BOT_TOKEN?? "7010774003:AAG_QVhmaE_QERw1hUU9CFXP0L5szxCCcrQ";

function combineStringsForCaption(str1, fromConfig) {
    const maxLength = 1024;
    // Проверяем, что вторая строка не превышает максимальную длину

    var len = str1.length + fromConfig.lengthl;

    if (len > maxLength) {
        str1 = str1.substring(0, maxLength - fromConfig.length - 4);
        str1 += '...';
    }

    return str1 + fromConfig;
}

function currentDate() {
    const today = new Date();

    // Extract day, month, and year
    const day = String(today.getDate()).padStart(2, '0'); // Ensure two digits for the day
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are zero-based, so add 1
    const year = today.getFullYear();

    // Return the formatted date
    return `${day}.${month}.${year}`;
}

module.exports = {
    SOURCE,
    MEDIA_TYPE,
    lastIndexDir,
    lastIndexSuff,
    downloadDirectoryBase,
    VK_TOKEN,
    BOT_TOKEN,
    combineStringsForCaption,
    currentDate
};