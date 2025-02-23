const SOURCE = { REDDIT: "reddit", VK: 'vk' };
const MEDIA_TYPE = { IMAGE: 'image', VIDEO: 'video' };
const lastIndexDir = './last_index';
const lastIndexSuff = '_last_index.txt';
const downloadDirectoryBase = './downloads';

const VK_TOKEN = process.env.VK_TOKEN;
const BOT_TOKEN = process.env.BOT_TOKEN;

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