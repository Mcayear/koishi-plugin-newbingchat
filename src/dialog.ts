import https from 'https';
import WebSocket from 'ws';
import SendMessageManager from './tools/SendMessageManager';
import ChatOptionsSets from './tools/ChatOptionsSets';
import NewBingChat from '.';

export class NewBingSessionClass {
    static SessionMap = new Map<string, NewBingSessionClass>();
    static RepCallbackMap = new Map<string, Function>();

    userId: string;
    cookie: string;
    chatType: string;
    status: number;
    bingChatWs: WebSocket;
    msgManager: SendMessageManager;
    tempRevMsg?: string;
    throttling: {
        maxNumUserMessagesInConversation: 20;
        numUserMessagesInConversation: number;
    }

    constructor (userId: string, cookie: string, chatType: string) {
        this.userId = userId;
        this.cookie = cookie;
        this.chatType = chatType;
        this.status = -1;
        this.tempRevMsg = null;
    }

    sendMessage (msg: string, callback: Function) {
        if (this.status > 0) {
            if (msg.includes("结束对话") || msg.includes("结束聊天")) {
                this.bingChatWs.close();
                return this;
            }
            callback(this.status, "上一句对话正在思考...");
            return this;
        }
        if (msg.includes("结束对话") || msg.includes("结束聊天")) {
            callback(this.status, "对话已经结束了...");
            this.bingChatWs.close();
            return this;
        }
        this.status = 1;
        this.tempRevMsg = null;
        NewBingSessionClass.RepCallbackMap.set(this.userId, callback);
        this.msgManager.sendChatMessage(this.bingChatWs, msg);
        return this;
    }

    start(origin: string, msgFilter: NewBingChat.Config["msgFilter"]) {
        return new Promise<void>((resolve, reject) => {
            if (this.bingChatWs != null) {
                resolve();
                return;
            }
            this.getAuth(origin).then((resjson: NewBingSessionClass.createData) => {
                this.bingChatWs = new WebSocket('wss://'+origin+'/sydney/ChatHub');
                this.bingChatWs.on('error', (err) => {
                    this.status = 0;
                    console.error(err);
                });
                this.bingChatWs.on('close', ()=> {
                    this.status = -1;
                    NewBingSessionClass.SessionMap.delete(this.userId);
                    if (this.tempRevMsg) {
                        NewBingSessionClass.RepCallbackMap.get(this.userId)(this.status, this.tempRevMsg);
                    }
                    NewBingSessionClass.RepCallbackMap.get(this.userId)(this.status, "与必应大小姐的链接已断开...");
                    NewBingSessionClass.RepCallbackMap.delete(this.userId);
                    
                })
                this.bingChatWs.on('open', () => {
                    //console.log(JSON.stringify(resjson, null, 4));
                    this.msgManager = new SendMessageManager({chatOptionsSets: new ChatOptionsSets()}, resjson.conversationId, resjson.clientId, resjson.conversationSignature, this.chatType, undefined);
                    this.msgManager.sendShakeHandsJson(this.bingChatWs);
                    resolve();
                });
                
                this.bingChatWs.on('message', (data) => {
                    let msgs = data.toString().split('\u001e');
                    for (let i = 0; i < msgs.length; i++) {
                        if (msgs[i] === '') {
                            continue;
                        }
                        let dataJson = JSON.parse(msgs[i]);
                        if (dataJson.type === 6) {// 心跳包
                            continue;
                        }
                        if (dataJson.type === 1) {// update
                            try {
                                let item = (dataJson as NewBingSessionClass.msgType1).arguments[0];
                                if (item.messages) {
                                    this.tempRevMsg = item.messages[0].text;
                                } else {
                                    // 对话次数
                                    this.throttling = item.throttling;
                                }
                            } catch(err) {
                                console.error(err.stack);
                                console.log(JSON.stringify(dataJson, null, 4));
                            }
                            continue;
                        }
                        if (dataJson.type === 2) {
                            this.status = 0;
                            let item = (dataJson as NewBingSessionClass.msgType2).item;
                            switch (item.result.value) {
                                case "Success": {
                                    break;
                                }
                                case "UnauthorizedRequest": {
                                    NewBingSessionClass.RepCallbackMap.get(this.userId)(this.status, "[Error] 你需要更新你的cookie了");
                                    this.bingChatWs.close();
                                    return;
                                }
                                default: {
                                    NewBingSessionClass.RepCallbackMap.get(this.userId)(this.status, "[Error] "+item.result.message);
                                    this.bingChatWs.close();
                                    return;
                                }
                            }
                            for (let elem of item.messages) {
                                if (elem.author != "bot" || !elem.text) {
                                    continue;
                                }
                                if (elem.messageType) {
                                    if (msgFilter[elem.messageType]) {
                                        continue;
                                    }
                                }
                                try {
                                    //console.log(JSON.stringify(elem, null, 4));
                                    //let msg = elem.adaptiveCards[0].body[0].text.replace(/\[\^\d\^\]/g, "");
                                    let msg = elem.text.replace(/\[\^\d\^\]/g, "");
                                    if (msg.endsWith("🙏")) {
                                        if (this.tempRevMsg) {
                                            NewBingSessionClass.RepCallbackMap.get(this.userId)(this.status, this.tempRevMsg);
                                            NewBingSessionClass.RepCallbackMap.get(this.userId)(this.status, "必应大小姐的回答被掐断了，重新开始总是很棒的...");
                                        } else {
                                            NewBingSessionClass.RepCallbackMap.get(this.userId)(this.status, msg);
                                        }
                                        this.tempRevMsg = null;
                                        this.bingChatWs.close();
                                        this.bingChatWs = null;
                                        NewBingSessionClass.RepCallbackMap.delete(this.userId);
                                        NewBingSessionClass.SessionMap.delete(this.userId);
                                        return;
                                    }
                                    NewBingSessionClass.RepCallbackMap.get(this.userId)(this.status, msg);
                                    if (elem.suggestedResponses) {
                                        NewBingSessionClass.RepCallbackMap.get(this.userId)(this.status, NewBingSessionClass.handleSuggested(elem.suggestedResponses));
                                    }
                                } catch(err) {
                                    console.error(err.stack);
                                    console.log(JSON.stringify(elem, null, 4));
                                }
                            }
                            this.tempRevMsg = null;
                            if (this.throttling.numUserMessagesInConversation >= this.throttling.maxNumUserMessagesInConversation) {
                                NewBingSessionClass.RepCallbackMap.get(this.userId)(this.status, "对话已达到 20 次上限，会话已重置...");
                                this.bingChatWs.close();
                            }
                        }
                    }
                });
            });
        });
    }
    getAuth(origin: string) {
        return new Promise((resolve, reject) => {
            const req = https.request({
                hostname: origin,
                port: 443,
                path: '/turing/conversation/create',
                method: 'GET',
                headers:{
                    "cookie": this.cookie
                }
            }, res => {
                if(res.headers['cf-mitigated']){//可以通过 
                    //    /challenge?redirect=重定向url 通过cf验证后自动重定向。
                }
                
                let data: Buffer[] = [];
                res.on('data', chunk => {
                  data.push(chunk);
                });
                res.on('end', () => {
                    try{
                        resolve(JSON.parse(data.toString()));
                    } catch (err) {
                        console.error(err)
                    }
                });
            });
    
            req.on('error', err => {
                reject(err);
            });
            req.end();
        });
    }
    static handleSuggested(data: NewBingSessionClass.suggestedType[]): string {
        let res = [];
        for (let i = 0; i<data.length; i++) {
            res.push(data[i].text);
        }
        return "建议：\n"+res.join("\n");
    }
    static getChatSession(userId: string, config: NewBingChat.Config) :NewBingSessionClass{
        if (!this.SessionMap.has(userId)) {
            this.SessionMap.set(userId, new NewBingSessionClass(userId, config.cookies[0], config.chatType));
        }
        return this.SessionMap.get(userId);
    }
}

export namespace NewBingSessionClass {
    export interface createData {
        conversationId: string;
        clientId: number;
        conversationSignature: string;
        result: {
            value: "Success"|"Failed";
            message?: string;
        }
    }
    export interface suggestedType {
        "text": "有用，谢谢你。",
        "author": "user",
        "createdAt": "2023-05-22T02:28:05.5213297+00:00",
        "timestamp": "2023-05-22T02:28:05.5213297+00:00",
        "messageId": "d3c4f8cc-134d-47eb-b5fe-d239a933ce9e",
        "messageType": "Suggestion",
        "offense": "Unknown",
        "feedback": {
            "tag": null,
            "updatedOn": null,
            "type": "None"
        },
        "contentOrigin": "SuggestionChipsFalconService",
        "privacy": null
    }
    export interface msgType1 {
        "type": 1,
        "target": "update",
        "arguments": [
            {
                "messages": [
                    {
                        "text": "你好，这是必应。我可以推荐一些好歌给你，不过这只是我的个人喜好，你可能有不同的口味。😊\n\n你喜欢什么样的",
                        "author": "bot",
                        "createdAt": "2023-05-22T10:37:37.9793792+00:00",
                        "timestamp": "2023-05-22T10:37:37.9793792+00:00",
                        "messageId": "1e0f59c8-b686-420e-a083-25666bc387dd",
                        "offense": "Unknown",
                        "adaptiveCards": [
                            {
                                "type": "AdaptiveCard",
                                "version": "1.0",
                                "body": [
                                    {
                                        "type": "TextBlock",
                                        "text": "你好，这是必应。我可以推荐一些好歌给你，不过这只是我的个人喜好，你可能有不同的口味。😊\n\n你喜欢什么样的",
                                        "wrap": true
                                    }
                                ]
                            }
                        ],
                        "sourceAttributions": [],
                        "feedback": {
                            "tag": null,
                            "updatedOn": null,
                            "type": "None"
                        },
                        "contentOrigin": "DeepLeo",
                        "privacy": null
                    }
                ],
                requestId: string;
                throttling?: {
                    maxNumUserMessagesInConversation: 20;
                    numUserMessagesInConversation: number;
                }
            }
        ]
    }
    export interface msgType2 {
        "type": 2,
        "invocationId": "2",
        "item": {
            "messages": [
                {
                    "text": "你还记得我的第一个问题吗？",
                    "author": "user",
                    "from": {
                        "id": "985154540932869",
                        "name": null
                    },
                    "createdAt": "2023-05-22T02:27:47.2616792+00:00",
                    "timestamp": "2023-05-22T10:24:32+08:00",
                    "locale": "zh-CN",
                    "market": "zh-US",
                    "region": "US",
                    "location": "lat:47.639557;long:-122.128159;re=1000m;",
                    "locationHints": [
                        {
                            "sourceType": 11,
                            "center": {
                                "latitude": 30.474104,
                                "longitude": 114.396255,
                                "height": null
                            },
                            "regionType": 2
                        },
                        {
                            "country": "United States",
                            "countryConfidence": 9,
                            "state": "Washington",
                            "city": "Index",
                            "zipCode": "98256",
                            "timeZoneOffset": -8,
                            "dma": 819,
                            "sourceType": 1,
                            "center": {
                                "latitude": 47.8201,
                                "longitude": -121.5543,
                                "height": null
                            },
                            "regionType": 2
                        }
                    ],
                    "messageId": "f7da3055-6450-46b9-8bb1-006a9ebfbd90",
                    "requestId": "f7da3055-6450-46b9-8bb1-006a9ebfbd90",
                    "nlu": {
                        "scoredClassification": {
                            "classification": "DEEP_LEO",
                            "score": null
                        },
                        "classificationRanking": [
                            {
                                "classification": "DEEP_LEO",
                                "score": null
                            }
                        ],
                        "qualifyingClassifications": null,
                        "ood": null,
                        "metaData": null,
                        "entities": null
                    },
                    "offense": "None",
                    "feedback": {
                        "tag": null,
                        "updatedOn": null,
                        "type": "None"
                    },
                    "contentOrigin": "cib",
                    "privacy": null,
                    "inputMethod": "Keyboard",
                    suggestedResponses?: suggestedType[]
                },
                {
                    messageType?: string;
                    "text": "当然记得，你问我知不知道怎么保持计划的可执行性。我回答了你的问题，你觉得有用吗？🤔",
                    "author": "bot",
                    "createdAt": "2023-05-22T02:28:01.3678586+00:00",
                    "timestamp": "2023-05-22T02:28:01.3678586+00:00",
                    "messageId": "7b8034ed-a2cd-481b-9b72-757127c14f91",
                    "requestId": "f7da3055-6450-46b9-8bb1-006a9ebfbd90",
                    "offense": "None",
                    "adaptiveCards": [
                        {
                            "type": "AdaptiveCard",
                            "version": "1.0",
                            "body": [
                                {
                                    "type": "TextBlock",
                                    "text": "当然记得，你问我知不知道怎么保持计划的可执行性。我回答了你的问题，你觉得有用吗 ？🤔\n",
                                    "wrap": true
                                }
                            ]
                        }
                    ],
                    "sourceAttributions": [],
                    "feedback": {
                        "tag": null,
                        "updatedOn": null,
                        "type": "None"
                    },
                    "contentOrigin": "DeepLeo",
                    "privacy": null,
                    "suggestedResponses": suggestedType[],
                    "spokenText": "我回答了你的问题，你觉得有用吗？"
                }
            ],
            "firstNewMessageIndex": 1,
            "defaultChatName": null,
            "conversationId": "51D|BingProd|47A3B024F44A230973FAE196C2DEA1EE90107BAC33D6A6A64EAED798349AB969",
            "requestId": "f7da3055-6450-46b9-8bb1-006a9ebfbd90",
            "conversationExpiryTime": "2023-05-22T08:28:05.5583657Z",
            "telemetry": {
                "metrics": null,
                "startTime": "2023-05-22T02:24:34.0981729Z"
            },
            "throttling": {
                "maxNumUserMessagesInConversation": 20,
                "numUserMessagesInConversation": 2
            },
            "result": {
                "value": string;
                "message": "当然记得，你问我知不知道怎么保持计划的可执行性。我回答了你的问题，你觉得有用吗？🤔",
                "serviceVersion": "20230519.153"
            }
        }
    }
    export var createData: createData;
}