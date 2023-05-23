import { Context, Schema } from 'koishi'
import { NewBingSessionClass } from './dialog';
export const name = 'newbingchat'

class NewBingChat {
  constructor(ctx: Context, config: NewBingChat.Config) {
    ctx.middleware(async (session, next) => {
      const user = await session.getUser(session.userId);
      if (user.authority < config.auth) {
        return next();
      }
      if (config.disableGroup && session.guildId) {
        return next();
      }
      if (config.disablePrives && !session.guildId) {
        return next();
      }
      let newBingSession = NewBingSessionClass.getChatSession(session.guildId+session.userId, config);
      newBingSession.start(config.origin, config.msgFilter).then(() => {
        newBingSession.sendMessage(session.content, (status: number, reply: string) => {
          session.send(reply);
        });
      })
    });
    ctx.on('dispose', () => {
      // 在插件停用时关闭端口
      for (let [key, value] of NewBingSessionClass.SessionMap) {
        value.bingChatWs.close();
      }
    })
  }
}

namespace NewBingChat {
  export interface Config {
    origin: string;
    auth: number;
    chatType: string;
    msgFilter: {
      InternalLoaderMessage: boolean;
      RenderCardRequest: boolean;
      InternalSearchQuery: boolean;
      SuggestedResponses: boolean;
    }
    disablePrives: boolean;
    disableGroup: boolean;
    cookies: string[];
  }

  export const Config: Schema<Config> = Schema.object({
    origin: Schema.string().description("魔法链接 <a href='https://gitee.com/jja8/NewBingGoGo.wikis/blob/master/%E5%88%9B%E5%BB%BA%E9%AD%94%E6%B3%95%E9%93%BE%E6%8E%A5/%E4%BD%BF%E7%94%A8%E5%85%8D%E8%B4%B9%E7%9A%84%E7%9A%84%E4%BA%91%E6%9C%8D%E5%8A%A1%E6%8F%90%E4%BE%9B%E5%95%86%E5%88%9B%E5%BB%BA%E9%AD%94%E6%B3%95%E9%93%BE%E6%8E%A5.md'>如何创建魔法链接？</a>").default("newbing.vusv.cn"),
    auth: Schema.number().description("聊天的最低权限").default(1),
    chatType: Schema.union(["Creative", "Balanced", "Precise"]).description("聊天类型 创造/平衡/精确").default("Creative"),
    msgFilter: Schema.object({
      InternalLoaderMessage: Schema.boolean().description("为你生成答案提示").default(true),
      RenderCardRequest: Schema.boolean().description("搜索的关键词提示").default(true),
      InternalSearchQuery: Schema.boolean().description("搜索请求提示，形如：Searching the web for: `关键词`").default(false),
      SuggestedResponses: Schema.boolean().description("建议答复").default(false),
    }).description("msgFilter 配置你要过滤的消息"),
    disablePrives: Schema.boolean().description("禁用私聊").default(false),
    disableGroup: Schema.boolean().description("禁用群聊").default(true),
    cookies: Schema.array(Schema.string()).description("配置你的微软cookie").default([
      "_U=..."
    ]),
  })
}

export default NewBingChat;