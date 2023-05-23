import WebSocket from 'ws';

/**
 * 处理发送消息的类
 * */
export default class SendMessageManager {
    bingChat: any;
    invocationId: number;
    conversationId: string;
    clientId: number;
    conversationSignature: string;
    optionsSets: string;


    /**
     * 从对象创建
     * @param bingChat 对象
     * @param obj 对象
     * */
    static crateFromObj(bingChat: any, obj: { conversationId: string; clientId: number; conversationSignature: string; optionsSets: string; invocationId: number; }){
        return new SendMessageManager(
            bingChat,
            obj.conversationId,
            obj.clientId,
            obj.conversationSignature,
            obj.optionsSets,
            obj.invocationId
        );
    }

    /**
     * 将自己保存到obj
     * */
    saveToObj(){
        return{
            conversationId:this.conversationId,
            clientId:this.clientId,
            conversationSignature:this.conversationSignature,
            optionsSets:this.optionsSets,
            invocationId:this.invocationId
        }
    }

    /**
     * @param bingChat BingChat对象
     * @param conversationId 会话id
     * @param clientId 客户端id
     * @param conversationSignature 签名id
     * @param theChatType {"Creative","Balanced","Precise"} 聊天类型，默认平衡 Precise 或 Balanced 或 Creative
     * @param invocationId 对话id，也就是第几次对话
     */
    constructor(bingChat: any, conversationId: string, clientId: number, conversationSignature: string, theChatType: string, invocationId: number) {
        this.bingChat = bingChat;
        this.invocationId = !!invocationId?invocationId:1;
        this.conversationId = conversationId;
        this.clientId = clientId;
        this.conversationSignature = conversationSignature;
        this.optionsSets = !!theChatType?theChatType:'Balanced';
    }

    /**
     * 发送json数据
     * @param chatWebSocket
     * @param json
     * @return Promise<void>
     */
    async sendJson(chatWebSocket: WebSocket, json: { protocol: string; version: number; }) {
        //console.log('发送 %s', JSON.stringify(json, null, 4))
        let go = JSON.stringify(json) + '\u001e';
        await chatWebSocket.send(go);
    }
    /**
     * 获取用于发送的握手数据
     * @param chatWebSocket WebSocket
     * @return {Promise<void>}
     */
    async sendShakeHandsJson(chatWebSocket: WebSocket): Promise<void> {
        await this.sendJson(chatWebSocket, {
            "protocol": "json",
            "version": 1
        });
    }

    /***
     * 获取用于发送的聊天数据
     * @param chatWebSocket WebSocket
     * @param chat sreing 聊天消息
     * @return {Promise<void>}
     */
    async sendChatMessage(chatWebSocket: WebSocket, chat: string): Promise<void> {
        await this.sendJson(chatWebSocket, await this.bingChat.chatOptionsSets.getSendJson(this, chat));
        this.invocationId++;
    }
}