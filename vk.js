const fs = require('fs');
const axios = require('axios');
const https = require('https');
const { BOT_TOKEN, SOURCE, MEDIA_TYPE, lastIndexDir, lastIndexSuff, VK_TOKEN, combineStringsForCaption, currentDate } = require('./system.js');



async function useVk(channelSettings, currentSource) {
    if (currentSource.name != SOURCE.VK) {
        return;
    }

    if (VK_TOKEN == null) {
        console.error('!!!!!!!!!!!!___Skip vk: token is null__!!!!!!!!!!!!!!!!!!');
        return;
    }

    const sub_source = currentSource.sub_source;

    let file = `${lastIndexDir}/${channelSettings.channel_name}_${SOURCE.VK}_${sub_source}${lastIndexSuff}`;

    console.log('ckeck file: ' + file);
    if (!fs.existsSync(file)) {
        console.log('is not exist: ' + file);
        fs.writeFileSync(file, '');
        console.log('create file: ' + file);
    }

    let lastPostDate = fs.readFileSync(file, 'utf8');
    console.log('last post date: ' + lastPostDate);

    let needToSendCount = currentSource.dailyPosts;
    let needToFetch = needToSendCount * needToSendCount;//берем больше так пагинация всегда сверху вниз и нужно больше свежих постов захватить

    while (needToSendCount > 0) {

        console.log(`Fetch ${needToSendCount} posts`);

        try {
            const result = await fetchVkPosts(sub_source, needToFetch);

            if (result == null || result.items.length === 0) {
                console.log('No posts found.');
                return;
            }

            var posts = result.items;

            if (lastPostDate == '') {
                posts = posts.sort((a, b) => a.date - b.date).slice(0, needToSendCount);
            } else {
                posts = posts.filter(x => x.date > lastPostDate).sort((a, b) => a.date - b.date).slice(0, needToSendCount);
            }

            if (posts.length === 0) {
                console.log('No actual posts found.');
                return;
            }

            needToFetch -= needToSendCount;

            lastPostDate = posts[posts.length - 1].date;

            fs.writeFileSync(file, `${lastPostDate}`);

            for (const post of posts) {
                try {

                    var isSend = await sendVkPostToTelegram(channelSettings.id, currentSource.type, channelSettings.messageSufix, post);
                    needToSendCount -= isSend ? 1 : 0;
                } catch (error) {
                    console.error('Error post: ', error.message);
                }
            }

            console.log(`${needToSendCount} posts left to send`);
        } catch (error) {
            console.log('Error with group: ' + sub_source + '. Error message: ' + error.message);
        }
    }

    console.log('VK Completed.');
}

async function fetchVkPosts(vkGroupId, count) {
    try {
        const response = await axios.get('https://api.vk.com/method/wall.get', {
            params: {
                access_token: VK_TOKEN,
                v: '5.131',
                owner_id: vkGroupId,
                count: count,
                filter: 'all',
                offset: 0
            }
        });

        if (response.data && response.data.response) {
            return response.data.response;
        } else {
            console.error('Error fetching VK posts:', response.data.error || 'Unknown error');
            return null;
        }
    } catch (error) {
        console.error('Error in fetchVkPosts:', error.message);
        return null;
    }
}

async function sendVkPostToTelegram(chatId, availableTypes, messageSufix, post) {

    if (!post.attachments) {
        console.log('Skip post, empty attachments');
        return false;
    }

    var attachments = post.attachments;

    const imageUrls = [];
    const videoUrls = [];
    var title = post.text;
    const prefix = 'Video:';

    for (const attachment of attachments) {
        if (attachment.type == 'photo' && availableTypes.includes(MEDIA_TYPE.IMAGE)) {
            imageUrls.push(attachment.photo.sizes.pop().url);
            console.log('Post type: photo')
        } else if (attachment.type == 'video' && availableTypes.includes(MEDIA_TYPE.VIDEO)) {
            var videoUrl = await getVkVideoUrl(attachment.video.owner_id, attachment.video.id, attachment.video.access_key);

            if (videoUrl != '' && videoUrl != null) {
                console.log('Video: receice correct link');
                videoUrls.push(videoUrl);
            } else {
                console.log('Video: use as text');
                title += `\n${prefix} vk.com/video${attachment.video.owner_id}_${attachment.video.id}`;
            }
        } else {
            console.log(`Skip post. Attachment type: ${attachment.type}. Required types: ${availableTypes}`);
        }
    }

    //max 1024
    title = combineStringsForCaption(title, messageSufix);

    if (videoUrls.length == 0 && imageUrls.length == 0) {
        return false;
    }
    else if (videoUrls.length == 1 && imageUrls.length == 0) {

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
            chat_id: chatId,
            video: videoUrls[0],
            caption: title,
            parse_mode: 'HTML'
        });

        console.log('Singe video sent successfully!');
    }
    else if (videoUrls.length == 0 && imageUrls.length == 1) {

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
            chat_id: chatId,
            photo: imageUrls[0],
            caption: title,
            parse_mode: 'HTML'
        });

        console.log('Singe image sent successfully!');
    } else {
        var mediaArray = [];

        videoUrls.forEach(url => {
            mediaArray.push({
                type: 'video',
                media: url
            });
        });

        imageUrls.forEach(url => {
            mediaArray.push({
                type: 'photo',
                media: url
            });
        });

        mediaArray[0].caption = title;
        mediaArray[0].parse_mode = 'HTML';

        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`,
            {
                chat_id: chatId,
                media: mediaArray,
                caption: post.title + title,
                parse_mode: 'HTML'
            }
        );
        console.log('Gallery sent successfully!');
    }

    return true;
}

async function getVkVideoUrl(ownerId, videoId, accessKey) {
    try {
        const response = await axios.get('https://api.vk.com/method/video.get', {
            params: {
                access_token: VK_TOKEN,
                v: '5.131',
                videos: `${ownerId}_${videoId}_${accessKey}`
            }
        });

        if (response.data && response.data.response && response.data.response.items.length > 0) {
            return response.data.response.items[0].files?.mp4_720 || response.data.response.items[0].files?.mp4_480 || '';
        } else {
            console.warn('Failed to retrieve video URL:', response.data.error || 'Unknown error');
            return '';
        }
    } catch (error) {
        console.error('Error fetching video URL:', error.message);
        return '';
    }
}

module.exports = { useVk };