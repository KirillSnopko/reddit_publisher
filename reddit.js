const fs = require('fs');
const axios = require('axios');
const https = require('https');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); // Optional: Use ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegPath || '/path/to/ffmpeg');

const { BOT_TOKEN, SOURCE, MEDIA_TYPE, lastIndexDir, lastIndexSuff, downloadDirectoryBase, combineStringsForCaption } = require ('./system.js');

let sorting = 'top';
let time = 'all';
const postDelayMilliseconds = 250;

 async function useReddit(channelConfig) {
    if (channelConfig.source != SOURCE.REDDIT) {
        return;
    }

    console.log('Start [reddit]');

    for (const reddit of channelConfig.sub_source) {

        console.log('subreddit: ' + reddit);

        let file = `${lastIndexDir}/${SOURCE.REDDIT}_${reddit}${lastIndexSuff}`;
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, '');
        }

        const lastIndex = fs.readFileSync(file, 'utf8');
        console.log('last index: ' + lastIndex);


        try {
            const result = await fetchSubredditPosts(reddit, lastIndex, channelConfig);

            if (result == null || result.length === 0) {
                console.log('No posts found.');
                continue;
            }

            const index = result[result.length - 1].data.name;
            fs.writeFileSync(file, index);

            for (const post of result) {
                try {
                    await processPost(post.data, channelConfig);
                    await sleep();
                } catch (e) {
                    console.log('processPost error: ' + e.message);
                    log(e, true);
                }
            }

            console.log('Posts sent successfully.');
        } catch (error) {
            console.log('Error with subreddit: ' + reddit + '. Error message: ' + error.message);
        }
    }
}

async function fetchSubredditPosts(subreddit, lastPostId, config) {
    if (!lastPostId) lastPostId = config.startId;

    try {
        const response = await axios.get(
            `https://reddit-proxy.artsyom-avanesov.workers.dev/?url=https://www.reddit.com/r/${subreddit}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${config.dailyPosts}&after=${lastPostId}`,
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

        return data.data.children;
    } catch (error) {
        console.error(`Error fetching posts for ${subreddit}:`, error.response ? error.response.data : error.message);
        return null;
    }
}

async function processPost(post, config) {
    const postType = getPostType(post);
    const types = config.type;
    if ((postType === 'media' && post.url) || post.post_hint.includes('video')) {
        if (post.post_hint === 'image' && types.includes(MEDIA_TYPE.IMAGE)) {
            await sendImageToTelegram(post, config);
        } else if (post.post_hint.includes('video') && types.includes(MEDIA_TYPE.VIDEO)) {
            await sendVideoToTelegram(post, config);
        }
    } else if (postType === 'gallery' && types.includes(MEDIA_TYPE.IMAGE)) {
        await sendGalleryToTelegram(post, config);
    } else {
        console.log(`Unsupported type ${postType} (${post.post_hint})`);
    }
}

async function sendImageToTelegram(post, config) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
            {
                chat_id: config.id,
                photo: post.url,
                caption: combineStringsForCaption(post.title, config.messageSufix),
                parse_mode: 'HTML'
            }
        );
        console.log('Image sent successfully!');
    } catch (error) {
        console.error('Error sending image:', error.message);
    }
}

async function sendVideoToTelegram(post, config) {
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
        formData.append('chat_id', config.id); // Replace CHAT_ID with your actual chat ID
        formData.append('video', fs.createReadStream(mergedFilePath), { filename: 'video.mp4' }); // Attach the video file
        formData.append('caption', combineStringsForCaption(post.title, config.messageSufix)); // Add the caption
        formData.append('parse_mode', 'HTML');

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

async function sendGalleryToTelegram(post, config) {
    const mediaList = post.gallery_data.items.map(({ media_id }) => {
        const media = post.media_metadata[media_id];
        return { type: 'photo', media: media.s.u.replace('&', '&') };
    });

    try {
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`,
            {
                chat_id: config.id,
                media: mediaList,
                caption: combineStringsForCaption(post.title, config.messageSufix),
                parse_mode: 'HTML'
            }
        );
        console.log('Gallery sent successfully!');
    } catch (error) {
        console.error('Error sending gallery:', error.message);
    }
}

function getPostType(post) {
    if (post.post_hint === 'self' || post.is_self) return 'self';
    if (post.post_hint === 'image' || post.domain.includes('i.redd.it') || post.post_hint.includes('video')) return 'media';
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

function getFileName(post) {
    let fileName = '';
    const date = new Date(post.created * 1000);
    fileName += `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    fileName += `_score=${post.score}`;
    return fileName.slice(0, 240).replace(/[\uFE0E\uFE0F]/g, '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function sleep() {
    return new Promise((resolve) => setTimeout(resolve, postDelayMilliseconds));
}

module.exports = { useReddit };
