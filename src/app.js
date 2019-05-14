import Imap from 'imap';
import { inspect } from 'util';
import fs from 'fs';
import base64 from 'base64-stream';
import { spawn } from 'child_process';
import dropboxV2Api from 'dropbox-v2-api';
import dateFormat from 'dateformat';
import config from './config/config';

const dropbox = dropboxV2Api.authenticate({
    token: config.dropboxApiKey
});

const imap = new Imap({
    user: config.email,
    password: config.emailPassword,
    host: 'imap-mail.outlook.com',
    port: 993,
    tls: true,
    markSeen: true,
    markRead: true,
    authTimeout: 60000,
    connTimeout: 60000
});

function openInbox(cb) {
    imap.openBox('INBOX', false, cb);
}

imap.once('ready', function () {

    const dir = './pdf';
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    openInbox(function (err, box) {
        if (err) throw err;
        imap.search(['UNSEEN', ['FROM', 'm2u@bills.maybank2u.com.my']], function (err, results) {
            if (err || !results.length) return;

            //mark as read
            imap.setFlags(results, ['\\Seen'], function (err) {
                if (!err) {
                    console.log("marked as read");
                } else {
                    console.log(JSON.stringify(err, null, 2));
                }
            });

            // fetch all resulting messages
            let f = imap.fetch(results, {
                bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
                struct: true
            });
            f.on('message', function (msg, seqno) {
                console.log('Message #%d', seqno);
                let prefix = '(#' + seqno + ') ';
                msg.on('body', function (stream, info) {
                    let buffer = '';
                    stream.on('data', function (chunk) {
                        buffer += chunk.toString('utf8');
                    });
                    stream.once('end', function () {
                        console.log(prefix + 'Parsed header: %s', inspect(Imap.parseHeader(buffer)));
                    });
                });
                msg.once('attributes', function (attrs) {
                    let attachments = findAttachmentParts(attrs.struct);
                    console.log(prefix + 'Attributes: %s', inspect(attrs, false, 8));
                    for (let i = 0, len = attachments.length; i < len; ++i) {
                        let attachment = attachments[i];
                        /*This is how each attachment looks like {
                            partID: '2',
                            type: 'application',
                            subtype: 'octet-stream',
                            params: { name: 'file-name.ext' },
                            id: null,
                            description: null,
                            encoding: 'BASE64',
                            size: 44952,
                            md5: null,
                            disposition: { type: 'ATTACHMENT', params: { filename: 'file-name.ext' } },
                            language: null
                          }
                        */
                        console.log(prefix + 'Fetching attachment %s', attachment.params.name);
                        let f = imap.fetch(attrs.uid, { //do not use imap.seq.fetch here
                            bodies: [attachment.partID],
                            struct: true
                        });
                        //build function to process attachment message
                        attachment.date = attrs.date;
                        f.on('message', buildAttMessageFunction(attachment));
                    }
                });
                msg.once('end', function () {
                    console.log(prefix + 'Finished');
                });
            });
            f.once('error', function (err) {
                console.log('Fetch error: ' + err);
                closeImap();
            });
            f.once('end', function () {
                console.log('Done fetching all messages!');
            });
        });
    });
});

imap.once('error', function (err) {
    console.log(err);
    closeImap();
});

imap.once('end', function () {
    console.log('Connection ended');
    closeImap();
});

imap.connect();
setInterval(() => {
    imap.connect();
}, 30 * 60 * 1000)

function toUpper(thing) { return thing && thing.toUpperCase ? thing.toUpperCase() : thing; }

function findAttachmentParts(struct, attachments) {
    attachments = attachments || [];
    for (let i = 0, len = struct.length, r; i < len; ++i) {
        if (Array.isArray(struct[i])) {
            findAttachmentParts(struct[i], attachments);
        } else {
            if (struct[i].disposition && ['INLINE', 'ATTACHMENT'].indexOf(toUpper(struct[i].disposition.type)) > -1) {
                attachments.push(struct[i]);
            }
        }
    }
    return attachments;
}

function buildAttMessageFunction(attachment) {

    let filename = './pdf/' + attachment.params.name;
    let fileDate = attachment.date;
    let encoding = attachment.encoding;

    return function (msg, seqno) {
        let prefix = '(#' + seqno + ') ';
        msg.on('body', function (stream, info) {
            //Create a write stream so that we can stream the attachment to file;
            console.log(prefix + 'Streaming this attachment to file', filename, info);
            let writeStream = fs.createWriteStream(filename);
            writeStream.on('finish', function () {
                console.log(prefix + 'Done writing to file %s', filename);
                processPdf(filename, fileDate);
            });

            //stream.pipe(writeStream); this would write base64 data to the file.
            //so we decode during streaming using 
            if (toUpper(encoding) === 'BASE64') {
                let decoder = new base64.Base64Decode();
                //the stream is base64 encoded, so here the stream is decode on the fly and piped to the write stream (file)
                stream.pipe(decoder).pipe(writeStream);
            } else {
                //here we have none or some other decoding streamed directly to the file which renders it useless probably
                stream.pipe(writeStream);
            }
        });
        msg.once('end', function () {
            console.log(prefix + 'Finished attachment %s', filename);
        });
    };
}

function processPdf(filename, fileDate) {

    let newFilename = dateFormat(fileDate, 'dd-mm-yyyy') + '.pdf';

    decryptPdf(filename, newFilename)
        .then(() => sendFile(newFilename))
        .then(() => removeFiles([filename, newFilename]))
        .then(() => closeImap());
}

function decryptPdf(filename, newFilename) {
    return new Promise((resolve, reject) => {
        let args = [
            filename,
            '--decrypt',
            '--password=' + config.pdfPassword,
            newFilename
        ]
        let child = spawn('qpdf', args);


        return child.once('exit', function () {
            console.log("Decrypted " + filename + " to " + newFilename);
            resolve();
        });
    });
}

function sendFile(newFilename) {
    let year = newFilename.substr(6, 4);
    dropbox({
        resource: 'files/upload',
        parameters: {
            path: '/statement_ppc/' + year + '/' + newFilename
        },
        readStream: fs.createReadStream(newFilename)
    }, (err, result, response) => {
        //upload completed
        console.log(result);
    });
}

function removeFiles(filenames) {
    return new Promise((resolve, reject) => {
        deleteFiles(filenames, function (err) {
            resolve();
        });
    });
}

function deleteFiles(files, callback) {
    let i = files.length;
    files.forEach(function (filepath) {
        fs.unlink(filepath, function (err) {
            i--;
            if (err) {
                callback(err);
                return;
            } else if (i <= 0) {
                callback(null);
            }
        });
    });
}

function closeImap() {
    imap.destroy();
    imap.end();
}