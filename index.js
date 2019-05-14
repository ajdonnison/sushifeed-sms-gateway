const parse = require('mailparser').simpleParser
const AWS = require('aws-sdk')
const S3 = new AWS.S3({ httpOptions: { timeout: 2000, connectTimeout: 1000 } })
const SNS = new AWS.SNS()

exports.handler = function (event, context, callback) {
  var message = event.Records[0].ses
  console.log('SES content:\n', JSON.stringify(message, null, 2))

  const getRecipient = function (recipientList) {
    console.log('extracting recipient from', recipientList)
    return recipientList[0].split('@')[0]
  }

  if (message.receipt.dkimVerdict.status === 'FAIL' ||
       message.receipt.spamVerdict.status === 'FAIL' ||
       message.receipt.spfVerdict.status === 'FAIL' ||
       message.receipt.virusVerdict.status === 'FAIL') {
    console.log('Dropping spam')
    callback(null, { 'disposition': 'STOP_RULE_SET' })
  } else {
    // Strip out the phone number from the recipient
    let phone = getRecipient(message.mail.destination)
    console.log(phone)
    console.log(process.env)
    S3.getObject({
      Bucket: process.env.S3_BUCKET,
      Key: message.mail.messageId
    },
    (err, data) => {
      if (err) {
        console.log(err, err.stack)
        callback(err)
      } else {
        console.log('Raw email:\n' + data.Body)
        parse(data.Body.toString('ascii'))
          .then((email) => {
            console.log('Sending SMS')
            SNS.publish({
              PhoneNumber: phone,
              Message: email.text
            },
            (err, data) => {
              if (err) {
                console.log('failed to send SMS\n', err)
                callback(err)
              } else {
                console.log('Sent SMS', data)
                callback(null, null)
              }
            })
          })
      }
    })
  }
}
