"use strict"

// Import environment variables from .env file.
require("dotenv").config();

// Import packages.
const express = require("express");
const app = express();
const uuid = require("uuid/v4");
const cache = require("memory-cache");

// Launch server.
app.listen(process.env.PORT || 5000, () => {
    console.log(`server is listening to ${process.env.PORT || 5000}...`);
});

// Instanticate LINE Pay API SDK.
const line_pay = require("line-pay");
const pay = new line_pay({
    channelId: process.env.LINE_PAY_CHANNEL_ID,
    channelSecret: process.env.LINE_PAY_CHANNEL_SECRET,
    hostname: process.env.LINE_PAY_HOSTNAME,
    isSandbox: true
})

// Instantiate LINE Messaging API SDK.
const line_bot = require("@line/bot-sdk");
const bot_config = {
    channelAccessToken: process.env.LINE_BOT_ACCESS_TOKEN,
    channelSecret: process.env.LINE_BOT_CHANNEL_SECRET
}
const bot_middleware = line_bot.middleware(bot_config);
const bot_client = new line_bot.Client(bot_config);

// Webhook for Messaging API.
app.post("/webhook", bot_middleware, (req, res, next) => {
    res.sendStatus(200);

    req.body.events.map((event) => {
        // We skip connection validation message.
        if (event.replyToken == "00000000000000000000000000000000" || event.replyToken == "ffffffffffffffffffffffffffffffff") return;

        // We process payment if user says "チョコレート".
        if (event.type === "message"){
            if (event.message.text === "チョコレート"){
                let product_name = "チョコレート";
                let reservation = {
                    productName: product_name,
                    amount: 1,
                    currency: "JPY",
                    orderId: uuid(),
                    confirmUrl: process.env.LINE_PAY_CONFIRM_URL,
                    confirmUrlType: "SERVER"
                }

                pay.reserve(reservation).then((response) => {
                    // Add transactionId and userId to reservation object.
                    reservation.transactionId = response.info.transactionId;
                    reservation.userId = event.source.userId;

                    console.log(`Reservation was made. Detail is following.`);
                    console.log(reservation);

                    // Save order information
                    cache.put(response.info.transactionId, reservation);

                    // Send Pay by LINE Pay button.
                    let message = {
                        type: "template",
                        altText: `${product_name}を購入するには下記のボタンで決済に進んでください`,
                        template: {
                            type: "buttons",
                            text: `${product_name}を購入するには下記のボタンで決済に進んでください`,
                            actions: [
                                {type: "uri", label: "LINE Payで決済", uri: response.info.paymentUrl.web},
                            ]
                        }
                    }
                    return bot_client.replyMessage(event.replyToken, message);
                });
            }
        }
    });
});

// If user approve the payment, LINE Pay app call this webhook.
app.get("/pay/confirm", (req, res, next) => {
    if (!req.query.transactionId){
        console.log("Transaction Id not found.");
        return res.status(400).send("Transaction Id not found.");
    }

    // Retrieve the reservation from database.
    let reservation = cache.get(req.query.transactionId);
    if (!reservation){
        console.log("Reservation not found.");
        return res.status(400).send("Reservation not found.")
    }

    console.log(`Retrieved following reservation.`);
    console.log(reservation);

    let confirmation = {
        transactionId: req.query.transactionId,
        amount: reservation.amount,
        currency: reservation.currency
    }

    console.log(`Going to confirm payment with following options.`);
    console.log(confirmation);

    // Capture payment.
    return pay.confirm(confirmation).then((response) => {
        res.sendStatus(200);

        // Reply to user that payment has been completed.
        let messages = [{
            type: "sticker",
            packageId: 2,
            stickerId: 144
        },{
            type: "text",
            text: "ありがとうございます、チョコレートの決済が完了しました。"
        }]
        return bot_client.pushMessage(reservation.userId, messages);
    });
});
