// NodeJS Dependencies
const fs = require('fs');
const axios = require('axios');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');

// Configuration and constants
let config = require('./user_config_DEFAULT.json');
const BOT_TOKEN = '7010774003:AAG_QVhmaE_QERw1hUU9CFXP0L5szxCCcrQ';
const CHAT_ID = '-1002342607540';
const lastIndexSuff = '_last_index.txt';
const logFormat = 'txt';
let subredditList = ['Pikabu'];
let numberOfPosts = 5;
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

function startScript() {
    console.log('Start');
    const reddit = subredditList[0];
    console.log('subreddit: ' + reddit);
    if (!fs.existsSync(reddit + lastIndexSuff)) {
        fs.writeFileSync(reddit + lastIndexSuff, '');
    }
    const lastIndex = fs.readFileSync(reddit + lastIndexSuff, 'utf8');
    console.log('last index: ' + lastIndex);
    downloadSubredditPosts(reddit, lastIndex);
}

async function downloadSubredditPosts(subreddit, lastPostId) {
    if (!lastPostId) lastPostId = '';

    makeDirectories();
    try {
        const response = await axios.get(
            `https://www.reddit.com/r/${subreddit}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${numberOfPosts}&after=${lastPostId}`,
            {
                headers: {
                    'User-Agent': 'MyRedditDownloaderScript/1.0', // Replace with a unique identifier
                }
            },
        );
        const data = response.data;

        if (data.message === 'Not Found' || !data.data.children.length) {
            throw new Error('Subreddit not found or private.');
        }

        const index = data.data.children[data.data.children.length - 1].data.name;
        fs.writeFileSync(subreddit + lastIndexSuff, index);

        downloadedPosts.subreddit = data.data.children[0].data.subreddit;
        const isOver18 = data.data.children[0].data.over_18 ? 'nsfw' : 'clean';

        const downloadPath = `${downloadDirectoryBase}/${isOver18}/${subreddit}`;
        if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath, { recursive: true });

        for (const child of data.data.children) {
            await sleep();
            try {
                await processPost(child.data);
            } catch (e) {
                log(e, true);
            }
        }
    } catch (error) {
        console.error(`Error fetching posts for ${subreddit}:`, error.message);
    }
}

async function processPost(post) {
    const postType = getPostType(post);
    if (postType === 'media' && post.url) {
        if (post.post_hint === 'image') {
            await sendImageToTelegram(post);
        } else if (post.post_hint.includes('video')) {
            // await sendVideoToTelegram(post);
        }
    } else if (postType === 'gallery') {
        await sendGalleryToTelegram(post);
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
    const videoUrl = post.secure_media?.reddit_video?.fallback_url || post.media?.reddit_video?.fallback_url;
    if (!videoUrl) return;

    const downloadDir = `downloads/${subredditList[0]}`;
    const videoFileName = getFileName(post) + '.mp4';
    const audioUrl = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1) + 'audio';
    const audioFileName = videoFileName.replace('.mp4', '-audio.mp4');

    const videoFilePath = `${downloadDir}/${videoFileName}`;
    const audioFilePath = `${downloadDir}/${audioFileName}`;
    const mergedFilePath = `${downloadDir}/${videoFileName.replace('.mp4', '-merged.mp4')}`;

    try {
        await Promise.all([
            downloadMediaFile(videoUrl, videoFilePath),
            downloadMediaFile(audioUrl, audioFilePath),
        ]);

        ffmpeg()
            .input(videoFilePath)
            .input(audioFilePath)
            .output(mergedFilePath)
            .on('end', () => {
                fs.unlinkSync(videoFilePath);
                fs.unlinkSync(audioFilePath);
            })
            .run();

        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`,
            null,
            {
                params: {
                    chat_id: CHAT_ID,
                    video: fs.createReadStream(mergedFilePath),
                    caption: post.title,
                },
            }
        );
        console.log('Video sent successfully!');
    } catch (error) {
        console.error('Error processing video:', error.message);
    } finally {
        if (fs.existsSync(mergedFilePath)) fs.unlinkSync(mergedFilePath);
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
    if (config.file_naming_scheme.showSubreddit) fileName += `_${post.subreddit}`;
    if (config.file_naming_scheme.showAuthor) fileName += `_${post.author}`;
    if (config.file_naming_scheme.showTitle) fileName += `_${sanitizeFileName(post.title)}`;
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