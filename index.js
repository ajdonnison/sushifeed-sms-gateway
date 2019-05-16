const parse = require('mailparser').simpleParser
const AWS = require('aws-sdk')
const S3 = new AWS.S3({ httpOptions: { timeout: 2000, connectTimeout: 1000 } })
const SNS = new AWS.SNS()
const _async = require('async')

exports.handler = function (event, context, callback) {
  var message = event.Records[0].ses

  const getRecipient = function (recipientList) {
    console.log('extracting recipient from', recipientList)
    return recipientList.map(el => el.split('@')[0])
  }

  if (message.receipt.dkimVerdict.status === 'FAIL' ||
       message.receipt.spamVerdict.status === 'FAIL' ||
       message.receipt.spfVerdict.status === 'FAIL' ||
       message.receipt.virusVerdict.status === 'FAIL') {
    console.log('Dropping spam')
    return callback(null, { 'disposition': 'STOP_RULE_SET' })
  }

  // Needs more work, should look for the first available link
  // and wrap some text around it.
  const urlmatch = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*)/
  const extractLink = function (text) {
    let data = text.split(/[\r\n]/)
    for (let line of data) {
      let url = line.match(urlmatch)
      if (url) {
        console.log(url)
        return `${process.env.MESSAGE_PREFIX} ${url[0]} ${process.env.MESSAGE_POSTFIX}`
      }
    }
    return 'You have a message'
  }

  let phones = getRecipient(message.mail.destination)
  let emailstruct
  let parsedEmail

  console.log(phones)
  _async.series([
    done => S3.getObject({
      Bucket: process.env.S3_BUCKET,
      Key: message.mail.messageId
    },
    (err, data) => {
      if (err) {
        console.log(err, err.stack)
        return done(err)
      }
      emailstruct = data
      done()
    }),
    done => parse(emailstruct.Body.toString('ascii'), (err, data) => {
      if (err) {
        console.log(err)
        return done(err)
      }
      parsedEmail = extractLink(data.text)
      done()
    }),
    done => {
      _async.eachOf(phones, (phone, ix, done) => {
        SNS.publish({
          PhoneNumber: phone,
          Message: parsedEmail
        },
        (err, data) => {
          if (err) {
            console.log('failed to send SMS\n', err)
            return done(err)
          }
          console.log(data)
          done()
        })
      },
      err => {
        done(err)
      })
    }
  ],
  err => {
    if (err) {
      console.log(err)
      return callback(err)
    }
    callback(null, null)
  }
  )
}
