// NodeJS Dependencies
const fs = require('fs');
const prompts = require('prompts');
const chalk = require('chalk');
const axios = require('axios');

const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');

let config = require('./user_config_DEFAULT.json');

const BOT_TOKEN = '7010774003:AAG_QVhmaE_QERw1hUU9CFXP0L5szxCCcrQ';
const CHAT_ID = '-1002342607540';


// Variables used for logging
let userLogs = '';
const logFormat = 'txt';
let date = new Date();
let date_string = `${date.getFullYear()} ${date.getMonth() + 1
    } ${date.getDate()} at ${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;
let startTime = null;
let lastAPICallForSubreddit = false;
let currentAPICall = null;

let currentSubredditIndex = 0; // Used to track which subreddit the user is downloading from
let responseSize = -1; // Used to track the size of the response from the API call, aka how many posts are in the response

// User-defined variables, these can be preset with the help of testingMode
let subredditList = ["Pikabu"]; // List of subreddits in this format: ['subreddit1', 'subreddit2', 'subreddit3']
let numberOfPosts = 1; // How many posts to go through, more posts = more downloads, but takes longer
let sorting = 'top'; // How to sort the posts (top, new, hot, rising, controversial)
let time = 'all'; // What time period to sort by (hour, day, week, month, year, all)
let downloadDirectory = ''; // Where to download the files to, defined when
let downloadDirectoryBase = './downloads'; // Default download path, can be overridden
const postDelayMilliseconds = 250;

// Default object to track the downloaded posts by type,
// and the subreddit downloading from.
let downloadedPosts = {
    subreddit: '',
    self: 0,
    media: 0,
    link: 0,
    failed: 0,
    skipped_due_to_duplicate: 0,
    skipped_due_to_fileType: 0,
};


startScript();

function startScript() {
    if (!fs.existsSync('last_index.txt')) {
        fs.writeFileSync('last_index.txt', '', (err) => { if (err) throw err; });
    }

    //set last index
    var lastIndex = fs.readFileSync('./last_index.txt', 'utf8');

    downloadSubredditPosts(subredditList[0], lastIndex);
}

async function downloadSubredditPosts(subreddit, lastPostId) {
    let isUser = false;
    let postsRemaining = numberOfPostsRemaining()[0];
    if (postsRemaining <= 0) {
        // If we have downloaded enough posts, move on to the next subreddit
        if (subredditList.length > 1) {
            return downloadNextSubreddit();
        } else {
            // If we have downloaded all the subreddits, end the program
            return checkIfDone('', true);
        }
        return;
    } else if (postsRemaining > 100) {
        // If we have more posts to download than the limit of 100, set it to 100
        postsRemaining = 100;
    }

    // if lastPostId is undefined, set it to an empty string. Common on first run.
    if (lastPostId == undefined) {
        lastPostId = '';
    }
    makeDirectories();

    try {
        if (subreddit == undefined) {
            if (subredditList.length > 1) {
                return downloadNextSubreddit();
            } else {
                return checkIfDone();
            }
        }

        // Use log function to log a string
        // as well as a boolean if the log should be displayed to the user.
        if (isUser) {
            log(
                `\n\n👀 Requesting posts from
				https://www.reddit.com/user/${subreddit.replace(
                    'u/',
                    '',
                )}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${postsRemaining}&after=${lastPostId}\n`,
                true,
            );
        } else {
            log(
                `\n\n👀 Requesting posts from
			https://www.reddit.com/r/${subreddit}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${postsRemaining}&after=${lastPostId}\n`,
                true,
            );
        }

        // Get the top posts from the subreddit
        let response = null;
        let data = null;

        try {
            response = await axios.get(
                `https://www.reddit.com/r/${subreddit}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${postsRemaining}&after=${lastPostId}`,
            );

            data = await response.data;

            currentAPICall = data;

            var children = currentAPICall.data.children;

            var index = children[children.length - 1].data.name;

            if (index != null) {
                //clean file
                fs.truncateSync('last_index.txt', 0, function () { console.log('done') });

                fs.writeFileSync("last_index.txt", index, (err) => {
                    if (err) console.log(err);
                    else {
                        console.log("Update last index successfully\n");
                    }
                });
            }

            if (data.message == 'Not Found' || data.data.children.length == 0) {
                throw error;
            }
            if (data.data.children.length < postsRemaining) {
                lastAPICallForSubreddit = true;
                postsRemaining = data.data.children.length;
            } else {
                lastAPICallForSubreddit = false;
            }
        } catch (err) {
            log(
                `\n\nERROR: There was a problem fetching posts for ${subreddit}. This is likely because the subreddit is private, banned, or doesn't exist.`,
                true,
            );
            if (subredditList.length > 1) {
                if (currentSubredditIndex > subredditList.length - 1) {
                    currentSubredditIndex = -1;
                }
                currentSubredditIndex += 1;
                return downloadSubredditPosts(subredditList[currentSubredditIndex], '');
            } else {
                return checkIfDone('', true);
            }
        }

        // if the first post on the subreddit is NSFW, then there is a fair chance
        // that the rest of the posts are NSFW.
        let isOver18 = data.data.children[0].data.over_18 ? 'nsfw' : 'clean';
        downloadedPosts.subreddit = data.data.children[0].data.subreddit;

        if (!config.separate_clean_nsfw) {
            downloadDirectory =
                downloadDirectoryBase + `/${data.data.children[0].data.subreddit}`;
        } else {
            downloadDirectory =
                downloadDirectoryBase +
                `/${isOver18}/${data.data.children[0].data.subreddit}`;
        }

        // Make sure the image directory exists
        // If no directory is found, create one
        if (!fs.existsSync(downloadDirectory)) {
            fs.mkdirSync(downloadDirectory);
        }

        responseSize = data.data.children.length;

        for (const child of data.data.children) {
            await sleep();
            try {
                const post = child.data;
                await sendImageToTelegram(post);
            } catch (e) {
                log(e, true);
            }
        }
    } catch (error) {
        // throw the error
        throw error;
    }
}

async function sendImageToTelegram(post) {
    let postTypeOptions = ['self', 'media', 'link', 'poll', 'gallery'];
    let postType = -1; // default to no postType until one is found
    postType = getPostType(post, postTypeOptions);
    const imageFormats = ['jpeg', 'jpg', 'gif', 'png', 'mp4', 'webm', 'gifv'];

    if (postType != 3 && post.url !== undefined) {
        let downloadURL = post.url;

        try {
            const response = await axios.get(
                `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
                {
                    params: {
                        chat_id: CHAT_ID,
                        photo: downloadURL,
                        caption: post.title
                    },
                }
            );

            console.log('Image sent successfully!', response.data);
        } catch (error) {
            console.error('Error sending image:', error.response ? error.response.data : error.message);
        }
    }
}


function checkIfDone(lastPostId, override) {
    if (
        (lastAPICallForSubreddit &&
            lastPostId ===
            currentAPICall.data.children[responseSize - 1].data.name) ||
        numberOfPostsRemaining()[0] === 0 ||
        override ||
        (numberOfPostsRemaining()[1] === responseSize && responseSize < 100)
    ) {
        let endTime = new Date();
        let timeDiff = endTime - startTime;
        timeDiff /= 1000;
        let msPerPost = (timeDiff / numberOfPostsRemaining()[1])
            .toString()
            .substring(0, 5);
        if (numberOfPosts >= 99999999999999999999) {
            log(
                `Still downloading posts from ${chalk.cyan(
                    subredditList[currentSubredditIndex],
                )}... (${numberOfPostsRemaining()[1]}/all)`,
                false,
            );
        } else {
            log(
                `Still downloading posts from ${chalk.cyan(
                    subredditList[currentSubredditIndex],
                )}... (${numberOfPostsRemaining()[1]}/${numberOfPosts})`,
                false,
            );
        }
        if (numberOfPostsRemaining()[0] === 0) {
            log('Validating that all posts were downloaded...', false);
            setTimeout(() => {
                log(
                    '🎉 All done downloading posts from ' +
                    subredditList[currentSubredditIndex] +
                    '!',
                    false,
                );

                log(JSON.stringify(downloadedPosts), true);
                if (currentSubredditIndex === subredditList.length - 1) {
                    log(
                        `\n📈 Downloading took ${timeDiff} seconds, at about ${msPerPost} seconds/post`,
                        false,
                    );
                }

                // default values for next run (important if being run multiple times)
                downloadedPosts = {
                    subreddit: '',
                    self: 0,
                    media: 0,
                    link: 0,
                    failed: 0,
                    skipped_due_to_duplicate: 0,
                    skipped_due_to_fileType: 0,
                };

                if (currentSubredditIndex < subredditList.length - 1) {
                    downloadNextSubreddit();
                }
                return true;
            }, 1000);
        }
    } else {
        if (numberOfPosts >= 99999999999999999999) {
            log(
                `Still downloading posts from ${chalk.cyan(
                    subredditList[currentSubredditIndex],
                )}... (${numberOfPostsRemaining()[1]}/all)`,
                false,
            );
        } else {
            log(
                `Still downloading posts from ${chalk.cyan(
                    subredditList[currentSubredditIndex],
                )}... (${numberOfPostsRemaining()[1]}/${numberOfPosts})`,
                false,
            );
        }

        for (let i = 0; i < Object.keys(downloadedPosts).length; i++) {
            log(
                `\t- ${Object.keys(downloadedPosts)[i]}: ${Object.values(downloadedPosts)[i]
                }`,
                true,
            );
        }
        log('\n', true);

        if (numberOfPostsRemaining()[1] % 100 == 0) {
            return downloadSubredditPosts(
                subredditList[currentSubredditIndex],
                lastPostId,
            );
        }
        return false;
    }
}

function makeDirectories() {
    // Make needed directories for downloads,
    // clean and nsfw are made nomatter the subreddits downloaded
    if (!fs.existsSync(downloadDirectoryBase)) {
        fs.mkdirSync(downloadDirectoryBase);
    }
    if (config.separate_clean_nsfw) {
        if (!fs.existsSync(downloadDirectoryBase + '/clean')) {
            fs.mkdirSync(downloadDirectoryBase + '/clean');
        }
        if (!fs.existsSync(downloadDirectoryBase + '/nsfw')) {
            fs.mkdirSync(downloadDirectoryBase + '/nsfw');
        }
    }
}

function sleep() {
    return new Promise((resolve) => setTimeout(resolve, postDelayMilliseconds));
}

function getPostType(post, postTypeOptions) {
    log(`Analyzing post with title: ${post.title}) and URL: ${post.url}`, true);
    if (post.post_hint === 'self' || post.is_self) {
        postType = 0;
    } else if (
        post.post_hint === 'image' ||
        (post.post_hint === 'rich:video' && !post.domain.includes('youtu')) ||
        post.post_hint === 'hosted:video' ||
        (post.post_hint === 'link' &&
            post.domain.includes('imgur') &&
            !post.url_overridden_by_dest.includes('gallery')) ||
        post.domain.includes('i.redd.it') ||
        post.domain.includes('i.reddituploads.com')
    ) {
        postType = 1;
    } else if (post.poll_data != undefined) {
        postType = 3; // UNSUPPORTED
    } else if (post.domain.includes('reddit.com') && post.is_gallery) {
        postType = 4;
    } else {
        postType = 2;
    }
    log(
        `Post has type: ${postTypeOptions[postType]} due to their post hint: ${post.post_hint} and domain: ${post.domain}`,
        true,
    );
    return postType;
}

async function downloadMediaFile(downloadURL, filePath, postName) {
    try {
        const response = await axios({
            method: 'GET',
            url: downloadURL,
            responseType: 'stream',
        });

        response.data.pipe(fs.createWriteStream(filePath));

        return new Promise((resolve, reject) => {
            response.data.on('end', () => {
                downloadedPosts.media += 1;
                checkIfDone(postName);
                resolve();
            });

            response.data.on('error', (error) => {
                reject(error);
            });
        });
    } catch (error) {
        downloadedPosts.failed += 1;
        checkIfDone(postName);
        if (error.code === 'ENOTFOUND') {
            log(
                'ERROR: Hostname not found for: ' + downloadURL + '\n... skipping post',
                true,
            );
        } else {
            log('ERROR: ' + error, true);
        }
    }
}

async function downloadPost(post) {
    let postTypeOptions = ['self', 'media', 'link', 'poll', 'gallery'];
    let postType = -1; // default to no postType until one is found

    // Determine the type of post. If no type is found, default to link as a last resort.
    // If it accidentally downloads a self or media post as a link, it will still
    // save properly.
    postType = getPostType(post, postTypeOptions);

    // Array of possible (supported) image and video formats
    const imageFormats = ['jpeg', 'jpg', 'gif', 'png', 'mp4', 'webm', 'gifv'];

    // All posts should have URLs, so just make sure that it does.
    // If the post doesn't have a URL, then it should be skipped.
    if (postType == 4) {
        // Don't download the gallery if we don't want to
        if (!config.download_gallery_posts) {
            log(`Skipping gallery post with title: ${post.title}`, true);
            downloadedPosts.skipped_due_to_fileType += 1;
            return checkIfDone(post.name);
        }

        // The title will be the directory name
        const postTitleScrubbed = getFileName(post);
        let newDownloads = Object.keys(post.media_metadata).length;
        // gallery_data retains the order of the gallery, so we loop over this
        // media_id can be used as the key in media_metadata
        for (const { media_id, id } of post.gallery_data.items) {
            const media = post.media_metadata[media_id];
            // s=highest quality (for some reason), u=URL
            // URL contains &amp; instead of &
            const downloadUrl = media['s']['u'].replaceAll('&amp;', '&');
            const shortUrl = downloadUrl.split('?')[0];
            const fileType = shortUrl.split('.').pop();

            // Create directory for gallery
            const postDirectory = `${downloadDirectory}/${postTitleScrubbed}`;
            if (!fs.existsSync(postDirectory)) {
                fs.mkdirSync(postDirectory);
            }
            const filePath = `${postTitleScrubbed}/${id}.${fileType}`;
            const toDownload = await shouldWeDownload(post.subreddit, filePath);

            if (!toDownload) {
                if (--newDownloads === 0) {
                    downloadedPosts.skipped_due_to_duplicate += 1;
                    if (checkIfDone(post.name)) {
                        return;
                    }
                }
            } else {
                downloadMediaFile(
                    downloadUrl,
                    `${downloadDirectory}/${filePath}`,
                    post.name,
                );
            }
        }
    } else if (postType != 3 && post.url !== undefined) {
        let downloadURL = post.url;
        // Get the file type of the post via the URL. If it ends in .jpg, then it's a jpg.
        let fileType = downloadURL.split('.').pop();
        // Post titles can be really long and have invalid characters, so we need to clean them up.
        let postTitleScrubbed = sanitizeFileName(post.title);
        postTitleScrubbed = getFileName(post);

        if (postType === 0) {
            // DOWNLOAD A SELF POST
            let toDownload = await shouldWeDownload(
                post.subreddit,
                `${postTitleScrubbed}.txt`,
            );
            if (!toDownload) {
                downloadedPosts.skipped_due_to_duplicate += 1;
                return checkIfDone(post.name);
            } else {
                if (!config.download_self_posts) {
                    log(`Skipping self post with title: ${post.title}`, true);
                    downloadedPosts.skipped_due_to_fileType += 1;
                    return checkIfDone(post.name);
                } else {
                    // DOWNLOAD A SELF POST
                    let comments_string = '';
                    let postResponse = null;
                    let data = null;
                    try {
                        postResponse = await axios.get(`${post.url}.json`);
                        data = postResponse.data;
                    } catch (error) {
                        log(`Axios failure with ${post.url}`, true);
                        return checkIfDone(post.name);
                    }

                    // With text/self posts, we want to download the top comments as well.
                    // This is done by requesting the post's JSON data, and then iterating through each comment.
                    // We also iterate through the top nested comments (only one level deep).
                    // So we have a file output with the post title, the post text, the author, and the top comments.

                    comments_string += post.title + ' by ' + post.author + '\n\n';
                    comments_string += post.selftext + '\n';
                    comments_string +=
                        '------------------------------------------------\n\n';
                    if (config.download_comments) {
                        // If the user wants to download comments
                        comments_string += '--COMMENTS--\n\n';
                        data[1].data.children.forEach((child) => {
                            const comment = child.data;
                            comments_string += comment.author + ':\n';
                            comments_string += comment.body + '\n';
                            if (comment.replies) {
                                const top_reply = comment.replies.data.children[0].data;
                                comments_string += '\t>\t' + top_reply.author + ':\n';
                                comments_string += '\t>\t' + top_reply.body + '\n';
                            }
                            comments_string += '\n\n\n';
                        });
                    }

                    fs.writeFile(
                        `${downloadDirectory}/${postTitleScrubbed}.txt`,
                        comments_string,
                        function (err) {
                            if (err) {
                                log(err, true);
                            }
                            downloadedPosts.self += 1;
                            if (checkIfDone(post.name)) {
                                return;
                            }
                        },
                    );
                }
            }
        } else if (postType === 1) {
            // DOWNLOAD A MEDIA POST
            if (post.preview != undefined) {
                // Reddit stores fallback URL previews for some GIFs.
                // Changing the URL to download to the fallback URL will download the GIF, in MP4 format.
                if (post.preview.reddit_video_preview != undefined) {
                    log(
                        "Using fallback URL for Reddit's GIF preview." +
                        post.preview.reddit_video_preview,
                        true,
                    );
                    downloadURL = post.preview.reddit_video_preview.fallback_url;
                    fileType = 'mp4';
                } else if (post.url_overridden_by_dest.includes('.gifv')) {
                    // Luckily, you can just swap URLs on imgur with .gifv
                    // with ".mp4" to get the MP4 version. Amazing!
                    log('Replacing gifv with mp4', true);
                    downloadURL = post.url_overridden_by_dest.replace('.gifv', '.mp4');
                    fileType = 'mp4';
                } else {
                    let sourceURL = post.preview.images[0].source.url;
                    // set fileType to whatever imageFormat item is in the sourceURL
                    for (let i = 0; i < imageFormats.length; i++) {
                        if (
                            sourceURL.toLowerCase().includes(imageFormats[i].toLowerCase())
                        ) {
                            fileType = imageFormats[i];
                            break;
                        }
                    }
                }
            }
            if (post.media != undefined && post.post_hint == 'hosted:video') {
                // If the post has a media object, then it's a video.
                // We need to get the URL from the media object.
                // This is because the URL in the post object is a fallback URL.
                // The media object has the actual URL.
                downloadURL = post.media.reddit_video.fallback_url;
                fileType = 'mp4';
            } else if (
                post.media != undefined &&
                post.post_hint == 'rich:video' &&
                post.media.oembed.thumbnail_url != undefined
            ) {
                // Common for gfycat links
                downloadURL = post.media.oembed.thumbnail_url;
                fileType = 'gif';
            }
            if (!config.download_media_posts) {
                log(`Skipping media post with title: ${post.title}`, true);
                downloadedPosts.skipped_due_to_fileType += 1;
                return checkIfDone(post.name);
            } else {
                let toDownload = await shouldWeDownload(
                    post.subreddit,
                    `${postTitleScrubbed}.${fileType}`,
                );
                if (!toDownload) {
                    downloadedPosts.skipped_due_to_duplicate += 1;
                    if (checkIfDone(post.name)) {
                        return;
                    }
                } else {
                    downloadMediaFile(
                        downloadURL,
                        `${downloadDirectory}/${postTitleScrubbed}.${fileType}`,
                        post.name,
                    );
                }
            }
        } else if (postType === 2) {
            if (!config.download_link_posts) {
                log(`Skipping link post with title: ${post.title}`, true);
                downloadedPosts.skipped_due_to_fileType += 1;
                return checkIfDone(post.name);
            } else {
                let toDownload = await shouldWeDownload(
                    post.subreddit,
                    `${postTitleScrubbed}.html`,
                );
                if (!toDownload) {
                    downloadedPosts.skipped_due_to_duplicate += 1;
                    if (checkIfDone(post.name)) {
                        return;
                    }
                } else {
                    // DOWNLOAD A LINK POST
                    // With link posts, we create a simple HTML file that redirects to the post's URL.
                    // This enables the user to still "open" the link file, and it will redirect to the post.
                    // No comments or other data is stored.

                    if (
                        post.domain.includes('youtu') &&
                        config.download_youtube_videos_experimental
                    ) {
                        log(
                            `Downloading ${postTitleScrubbed} from YouTube... This may take a while...`,
                            false,
                        );
                        let url = post.url;
                        try {
                            // Validate YouTube URL
                            if (!ytdl.validateURL(url)) {
                                throw new Error('Invalid YouTube URL');
                            }

                            // Get video info
                            const info = await ytdl.getInfo(url);
                            log(info, true);

                            // Choose the highest quality format available
                            const format = ytdl.chooseFormat(info.formats, {
                                quality: 'highest',
                            });

                            // Create a filename based on the video title
                            const fileName = `${postTitleScrubbed}.mp4`;

                            // Download audio stream
                            const audio = ytdl(url, { filter: 'audioonly' });
                            const audioPath = `${downloadDirectory}/${fileName}.mp3`;
                            audio.pipe(fs.createWriteStream(audioPath));

                            // Download video stream
                            const video = ytdl(url, { format });
                            const videoPath = `${downloadDirectory}/${fileName}.mp4`;
                            video.pipe(fs.createWriteStream(videoPath));

                            // Wait for both streams to finish downloading
                            await Promise.all([
                                new Promise((resolve) => audio.on('end', resolve)),
                                new Promise((resolve) => video.on('end', resolve)),
                            ]);

                            // Merge audio and video using ffmpeg
                            ffmpeg()
                                .input(videoPath)
                                .input(audioPath)
                                .output(`${downloadDirectory}/${fileName}`)
                                .on('end', () => {
                                    console.log('Download complete');
                                    // Remove temporary audio and video files
                                    fs.unlinkSync(audioPath);
                                    fs.unlinkSync(videoPath);
                                    downloadedPosts.link += 1;
                                    if (checkIfDone(post.name)) {
                                        return;
                                    }
                                })
                                .run();
                        } catch (error) {
                            log(
                                `Failed to download ${postTitleScrubbed} from YouTube. Do you have FFMPEG installed? https://ffmpeg.org/ `,
                                false,
                            );
                            let htmlFile = `<html><body><script type='text/javascript'>window.location.href = "${post.url}";</script></body></html>`;

                            fs.writeFile(
                                `${downloadDirectory}/${postTitleScrubbed}.html`,
                                htmlFile,
                                function (err) {
                                    if (err) throw err;
                                    downloadedPosts.link += 1;
                                    if (checkIfDone(post.name)) {
                                        return;
                                    }
                                },
                            );
                        }
                    } else {
                        let htmlFile = `<html><body><script type='text/javascript'>window.location.href = "${post.url}";</script></body></html>`;

                        fs.writeFile(
                            `${downloadDirectory}/${postTitleScrubbed}.html`,
                            htmlFile,
                            function (err) {
                                if (err) throw err;
                                downloadedPosts.link += 1;
                                if (checkIfDone(post.name)) {
                                    return;
                                }
                            },
                        );
                    }
                }
            }
        } else {
            log('Failed to download: ' + post.title + 'with URL: ' + post.url, true);
            downloadedPosts.failed += 1;
            if (checkIfDone(post.name)) {
                return;
            }
        }
    } else {
        log('Failed to download: ' + post.title + 'with URL: ' + post.url, true);
        downloadedPosts.failed += 1;
        if (checkIfDone(post.name)) {
            return;
        }
    }
}

function downloadNextSubreddit() {
    if (currentSubredditIndex > subredditList.length) {
        checkIfDone('', true);
    } else {
        currentSubredditIndex += 1;
        downloadSubredditPosts(subredditList[currentSubredditIndex]);
    }
}

function shouldWeDownload(subreddit, postTitleWithPrefixAndExtension) {
    if (
        config.redownload_posts === true ||
        config.redownload_posts === undefined
    ) {
        if (config.redownload_posts === undefined) {
            log(
                chalk.red(
                    "ALERT: Please note that the 'redownload_posts' option is now available in user_config. See the default JSON for example usage.",
                ),
                true,
            );
        }
        return true;
    } else {
        // Check if the post in the subreddit folder already exists.
        // If it does, we don't need to download it again.
        let postExists = fs.existsSync(
            `${downloadDirectory}/${postTitleWithPrefixAndExtension}`,
        );
        return !postExists;
    }
}

function onErr(err) {
    log(err, true);
    return 1;
}

function getFileName(post) {
    let fileName = '';
    if (
        config.file_naming_scheme.showDate ||
        config.file_naming_scheme.showDate === undefined
    ) {
        let timestamp = post.created;
        var date = new Date(timestamp * 1000);
        var year = date.getFullYear();
        var month = (date.getMonth() + 1).toString().padStart(2, '0');
        var day = date.getDate().toString().padStart(2, '0');
        fileName += `${year}-${month}-${day}`;
    }
    if (
        config.file_naming_scheme.showScore ||
        config.file_naming_scheme.showScore === undefined
    ) {
        fileName += `_score=${post.score}`;
    }
    if (
        config.file_naming_scheme.showSubreddit ||
        config.file_naming_scheme.showSubreddit === undefined
    ) {
        fileName += `_${post.subreddit}`;
    }
    if (
        config.file_naming_scheme.showAuthor ||
        config.file_naming_scheme.showAuthor === undefined
    ) {
        fileName += `_${post.author}`;
    }
    if (
        config.file_naming_scheme.showTitle ||
        config.file_naming_scheme.showTitle === undefined
    ) {
        let title = sanitizeFileName(post.title);
        fileName += `_${title}`;
    }

    // remove special chars from name
    fileName = fileName.replace(/(?:\r\n|\r|\n|\t)/g, '');

    if (fileName.search(/\ufe0e/g) >= -1) {
        fileName = fileName.replace(/\ufe0e/g, '');
    }

    if (fileName.search(/\ufe0f/g) >= -1) {
        fileName = fileName.replace(/\ufe0f/g, '');
    }

    // The max length for most systems is about 255. To give some wiggle room, I'm doing 240
    if (fileName.length > 240) {
        fileName = fileName.substring(0, 240);
    }

    return fileName;
}

function numberOfPostsRemaining() {
    let total =
        downloadedPosts.self +
        downloadedPosts.media +
        downloadedPosts.link +
        downloadedPosts.failed +
        downloadedPosts.skipped_due_to_duplicate +
        downloadedPosts.skipped_due_to_fileType;
    return [numberOfPosts - total, total];
}

function log(message, detailed) {
    // This function takes a message string and a boolean.
    // If the boolean is true, the message will be logged to the console, otherwise it
    // will only be logged to the log file.
    userLogs += message + '\r\n';
    let visibleToUser = true;
    if (detailed) {
        visibleToUser = config.detailed_logs;
    }

    if (visibleToUser) {
        console.log(message);
    }
    if (config.local_logs && subredditList.length > 0) {
        if (!fs.existsSync('./logs')) {
            fs.mkdirSync('./logs');
        }

        let logFileName = '';
        if (config.local_logs_naming_scheme.showDateAndTime) {
            logFileName += `${date_string} - `;
        }
        if (config.local_logs_naming_scheme.showSubreddits) {
            let subredditListString = JSON.stringify(subredditList).replace(
                /[^a-zA-Z0-9,]/g,
                '',
            );
            logFileName += `${subredditListString} - `;
        }
        if (config.local_logs_naming_scheme.showNumberOfPosts) {
            if (numberOfPosts < 999999999999999999) {
                logFileName += `ALL - `;
            } else {
                logFileName += `${numberOfPosts} - `;
            }
        }

        if (logFileName.endsWith(' - ')) {
            logFileName = logFileName.substring(0, logFileName.length - 3);
        }

        fs.writeFile(
            `./logs/${logFileName}.${logFormat}`,
            userLogs,
            function (err) {
                if (err) throw err;
            },
        );
    }
}

// sanitize function for file names so that they work on Mac, Windows, and Linux
function sanitizeFileName(fileName) {
    return fileName
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/([^/])\/([^/])/g, '$1_$2');
}
