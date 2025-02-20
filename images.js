// NodeJS Dependencies
const fs = require('fs');
const axios = require('axios');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); // Optional: Use ffmpeg-static
const FormData = require('form-data');

// Set the FFmpeg path explicitly
ffmpeg.setFfmpegPath(ffmpegPath || '/path/to/ffmpeg');
const https = require('https');

// Configuration and constants
let config = require('./user_config_DEFAULT.json');

const BOT_TOKEN = process.env.BOT_TOKEN ?? "7010774003:AAG_QVhmaE_QERw1hUU9CFXP0L5szxCCcrQ";
const CHAT_ID = process.env.CHAT_ID ?? -1002342607540;
let subredditList = process.env.SUBREDDIT_LIST != null ? JSON.parse(process.env.SUBREDDIT_LIST) : [/*'Pikabu', 'MurderedByWords',*/ 'TikTokCringe'];
let numberOfPosts = process.env.NUMBER_OF_POSTS ?? 1;

const VK_TOKEN = process.env.VK_TOKEN; 
const vsGroups = process.env.VK_GROUP_LIST != null ? JSON.parse(process.env.VK_GROUP_LIST) : [-166517957];

const lastIndexSuff = '_last_index.txt';
const logFormat = 'txt';
let sorting = 'top';
let time = 'all';
let downloadDirectoryBase = './downloads';
const postDelayMilliseconds = 250;

let downloadedPosts = {
    subreddit: '',
    self: 0,
    media: 0,
    link: 0,
    failed: 0,
};

startScript();

async function startScript() {
    console.log('Start [reddit]');
    console.log('subreddits: ' + process.env.SUBREDDIT_LIST);

    for (const reddit of subredditList) {
        console.log('subreddit: ' + reddit);
        if (!fs.existsSync(reddit + lastIndexSuff)) {
            fs.writeFileSync(reddit + lastIndexSuff, '');
        }
        const lastIndex = fs.readFileSync(reddit + lastIndexSuff, 'utf8');
        console.log('last index: ' + lastIndex);
        try {
            await downloadSubredditPosts(reddit, lastIndex);
        } catch (error) {
            console.log('Error with subreddit: ' + reddit + '. Error message: ' + error.message);
        }
    }

    console.log('Start [vk]');
    console.log('vk_groups: ' + vsGroups);

    for (const group of vsGroups) {
        console.log('group: ' + group);
        var file = `vk_${group}${lastIndexSuff}`;
        console.log('ckeck file: ' + file);
        if (!fs.existsSync(file)) {
            console.log('is not exist: ' + file);
            fs.writeFileSync(file, '');
            console.log('create file: ' + file);
        }
        const offset = fs.readFileSync(file, 'utf8');
        console.log('last index: ' + offset);
        try {
            const result = await fetchVkPosts(group, offset);
            if (result == null || result.items.length === 0) {
                console.log('No posts found.');
                return;
            }

            fs.writeFileSync(file, result.next_from);

            for (const post of result.items) {
                await sendVkPostToTelegram(post);
            }

            console.log('Posts sent successfully.');
        } catch (error) {
            console.log('Error with group: ' + group + '. Error message: ' + error.message);
        }
    }
}

async function downloadSubredditPosts(subreddit, lastPostId) {
    if (!lastPostId) lastPostId = '';

    makeDirectories();
    try {
        const response = await axios.get(
            `https://reddit-proxy.artsyom-avanesov.workers.dev/?url=https://www.reddit.com/r/${subreddit}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${numberOfPosts}&after=${lastPostId}`,
            {
                headers: {
                    'User-Agent': 'github.com/KirillSnopko/reddit_publisher/job',
                },
                httpsAgent: new https.Agent({ rejectUnauthorized: false })
            },
        );
        const data = response.data;

        console.log(`reddit request [${subreddit}]: ${data.data.children != null ? 'OK' : 'FAIL'}`);

        if (data.message === 'Not Found' || !data.data.children.length) {
            throw new Error('Subreddit not found or private.');
        }

        const index = data.data.children[data.data.children.length - 1].data.name;
        fs.writeFileSync(subreddit + lastIndexSuff, index);

        downloadedPosts.subreddit = data.data.children[0].data.subreddit;
        const isOver18 = data.data.children[0].data.over_18 ? 'nsfw' : 'clean';

        /* const downloadPath = `${downloadDirectoryBase}/${subreddit}`;
         if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath, { recursive: true });*/

        for (const child of data.data.children) {
            try {
                await processPost(child.data);
                await sleep();
            } catch (e) {
                console.log('processPost error: ' + e.message);
                log(e, true);
            }
        }
    } catch (error) {
        console.error(`Error fetching posts for ${subreddit}:`, error.response ? error.response.data : error.message);
    }
}

async function processPost(post) {
    const postType = getPostType(post);
    if ((postType === 'media' && post.url) || post.post_hint.includes('video')) {
        if (post.post_hint === 'image') {
            await sendImageToTelegram(post);
        } else if (post.post_hint.includes('video')) {
            await sendVideoToTelegram(post);
        }
    } else if (postType === 'gallery') {
        await sendGalleryToTelegram(post);
    } else {
        console.log(`Unsupported type ${postType} (${post.post_hint})`);
    }
}

async function sendImageToTelegram(post) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
            {
                chat_id: CHAT_ID,
                photo: post.url,
                caption: post.title,
            }
        );
        console.log('Image sent successfully!');
    } catch (error) {
        console.error('Error sending image:', error.message);
    }
}

async function sendVideoToTelegram(post) {
    var videoUrl = post.secure_media?.reddit_video?.fallback_url?.split('?')[0];
    if (!videoUrl) return;

    const downloadDir = `${downloadDirectoryBase}/${post.subreddit}`;

    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    const videoFileName = getFileName(post) + '.mp4';

    let audio = false;
    var audioUrl = `${post.secure_media?.reddit_video?.fallback_url?.split('DASH')[0]}audio`;//videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1) + 'audio';

    if (videoUrl.match('.mp4')) {
        audioUrl = `${videoUrl.split('_')[0]}_audio.mp4`
    }

    // test the existence of audio
    await fetch(audioUrl, { method: "HEAD" }).then(r => {
        if (Number(r.status) === 200) {
            audio = true
        }
    }).catch(() => { })

    // fallback for videos with variable audio quality
    if (!audio) {
        audioUrl = `${videoUrl.split('_')[0]}_AUDIO_128.mp4`
        await fetch(audioUrl, { method: "HEAD" }).then(r => {
            if (Number(r.status) === 200) {
                audio = true
            }
        }).catch(() => { })
    }

    if (!audio) return;

    const audioFileName = videoFileName.replace('.mp4', '-audio.mp4');

    const videoFilePath = `${downloadDir}/${videoFileName}`;
    const audioFilePath = `${downloadDir}/${audioFileName}`;
    const mergedFilePath = `${downloadDir}/${videoFileName.replace('.mp4', '-merged.mp4')}`;

    try {
        await Promise.all([
            downloadMediaFile(videoUrl, videoFilePath),
            downloadMediaFile(audioUrl, audioFilePath),
        ]);
        var test = await new Promise((resolve, reject) => {
            ffmpeg()
                .input(videoFilePath)
                .input(audioFilePath)
                .output(mergedFilePath)
                .on('end', () => {
                    console.log('Merge completed successfully.');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('An error occurred while merging files:', err.message);
                    reject(err); // Reject the promise if an error occurs
                })
                .run();
        });

        const formData = new FormData();
        formData.append('chat_id', CHAT_ID); // Replace CHAT_ID with your actual chat ID
        formData.append('video', fs.createReadStream(mergedFilePath), { filename: 'video.mp4' }); // Attach the video file
        formData.append('caption', post.title); // Add the caption

        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`,
            formData,
        );
        console.log('Video sent successfully!');
    } catch (error) {
        console.error('Error processing video:', error.message);
    } finally {
        if (fs.existsSync(mergedFilePath)) {
            fs.unlinkSync(mergedFilePath);
            console.log(`Remove merged file:${mergedFilePath}`);
        }
        if (fs.existsSync(videoFilePath)) {
            fs.unlinkSync(videoFilePath);
            console.log(`Remove video file:${videoFilePath}`);
        }
        if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
            console.log(`Remove audio file:${audioFilePath}`);
        }
    }
}

async function sendGalleryToTelegram(post) {
    const mediaList = post.gallery_data.items.map(({ media_id }) => {
        const media = post.media_metadata[media_id];
        return { type: 'photo', media: media.s.u.replace('&', '&') };
    });

    try {
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`,
            {
                chat_id: CHAT_ID,
                media: mediaList,
                caption: post.title,
            }
        );
        console.log('Gallery sent successfully!');
    } catch (error) {
        console.error('Error sending gallery:', error.message);
    }
}

function getPostType(post) {
    if (post.post_hint === 'self' || post.is_self) return 'self';
    if (post.post_hint === 'image' || post.domain.includes('i.redd.it')) return 'media';
    if (post.domain.includes('reddit.com') && post.is_gallery) return 'gallery';
    return 'link';
}

async function downloadMediaFile(url, filePath) {
    try {
        const response = await axios({ method: 'GET', url, responseType: 'stream' });
        response.data.pipe(fs.createWriteStream(filePath));
        return new Promise((resolve, reject) => {
            response.data.on('end', resolve).on('error', reject);
        });
    } catch (error) {
        console.error('Error downloading media:', error.message);
    }
}

function makeDirectories() {
    if (!fs.existsSync(downloadDirectoryBase)) fs.mkdirSync(downloadDirectoryBase, { recursive: true });
    if (config.separate_clean_nsfw) {
        fs.mkdirSync(`${downloadDirectoryBase}/clean`, { recursive: true });
        fs.mkdirSync(`${downloadDirectoryBase}/nsfw`, { recursive: true });
    }
}

function getFileName(post) {
    let fileName = '';
    if (config.file_naming_scheme.showDate) {
        const date = new Date(post.created * 1000);
        fileName += `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    if (config.file_naming_scheme.showScore) fileName += `_score=${post.score}`;
    //if (config.file_naming_scheme.showSubreddit) fileName += `_${post.subreddit}`;
    //if (config.file_naming_scheme.showAuthor) fileName += `_${post.author}`;
    // if (config.file_naming_scheme.showTitle) fileName += `_${sanitizeFileName(post.title)}`;
    return fileName.slice(0, 240).replace(/[\uFE0E\uFE0F]/g, '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function sanitizeFileName(fileName) {
    return fileName.replace(/[/\\?%*:|"<>]/g, '-').replace(/([^/])\/([^/])/g, '$1_$2');
}

function checkIfDone() {
    console.log('All downloads completed.');
}

function sleep() {
    return new Promise((resolve) => setTimeout(resolve, postDelayMilliseconds));
}

async function fetchVkPosts(vkGroupId, offset) {
    try {
        const response = await axios.get('https://api.vk.com/method/wall.get', {
            params: {
                access_token: VK_TOKEN,
                v: '5.131', // VK API version
                owner_id: vkGroupId, // Group ID
                count: numberOfPosts, // Number of posts to fetch
                filter: 'owner', // Fetch only posts from the group itself
                offset: offset
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

async function sendVkPostToTelegram(post) {

    if (!post.attachments) {
        console.log('Skip post, empty attachments');
        return;
    }

    var attachments = post.attachments;

    const imageUrls = [];
    const videoUrls = [];
    var title = post.text;
    const prefix = 'Video:';

    for (const attachment of attachments) {
        switch (attachment.type) {
            case 'photo':
                imageUrls.push(attachment.photo.sizes.pop().url);
                console.log('Post type: photo');
                break;
            case 'video':
                var videoUrl = await getVkVideoUrl(attachment.video.owner_id, attachment.video.id, attachment.video.access_key);

                if (videoUrl != '' && videoUrl != null) {
                    console.log('Video: receice correct link');
                    videoUrls.push(videoUrl);
                } else {
                    console.log('Video: use as text');
                    title += `\n${prefix} vk.com/video${attachment.video.owner_id}_${attachment.video.id}`;
                }

                break;
        }
    };

    if (videoUrls.length == 0 && imageUrls.length == 0) {
        return;
    }
    else if (videoUrls.length == 1 && imageUrls.length == 0) {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
            chat_id: CHAT_ID,
            video: videoUrls[0],
            caption: text
        });
    }
    else if (videoUrls.length == 0 && imageUrls.length == 1) {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
            chat_id: CHAT_ID,
            photo: imageUrls[0],
            caption: text
        });
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

        try {
            await axios.post(
                `https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`,
                {
                    chat_id: CHAT_ID,
                    media: mediaArray,
                    caption: title,
                }
            );
            console.log('Gallery sent successfully!');
        } catch (error) {
            console.error('Error sending gallery:', error.message);
        }
    }
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
