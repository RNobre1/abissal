# Telegram Bot API — referência viva

> **Gerado** por `scripts/telegram/document-bot-api.ts` (`pnpm telegram:document-api`). Re-rode pra detectar drift — versão nova da Bot API, método/tipo que sumiu, etc. **NÃO editar à mão.**
>
> Esta é a **Bot API** (`https://core.telegram.org/bots/api` — `api.telegram.org/bot<token>/METHOD`), o que o Abissal consome. **NÃO** é a MTProto/`core.telegram.org/api` (cliente de conta de usuário), que está fora de escopo de propósito.

- **Versão da Bot API:** `Bot API 10.0`
- **Release:** May 8, 2026
- **Changelog:** https://core.telegram.org/bots/api#may-8-2026
- **Fonte estruturada:** https://raw.githubusercontent.com/PaulSonOfLars/telegram-bot-api-spec/main/api.json
- **Doc autoritativa:** https://core.telegram.org/bots/api
- **Catálogo:** 176 métodos · 303 tipos

## Métodos que o Abissal usa (ou vai usar)

Subconjunto curado com detalhe (params obrigatórios + returns). O catálogo completo vem depois.

### `sendMessage` → Message

**Uso no projeto:** resumo de fechamento diário + alertas proativos one-way

Use this method to send text messages. On success, the sent Message is returned.

| param (required) | tipos | descrição |
|---|---|---|
| `chat_id` | `Integer`, `String` | Unique identifier for the target chat or username of the target bot, supergroup or channel in the format @username |
| `text` | `String` | Text of the message to be sent, 1-4096 characters after entities parsing |

[doc oficial](https://core.telegram.org/bots/api#sendmessage)

### `getMe` → User

**Uso no projeto:** health-check do token (valida o bot ao configurar)

A simple method for testing your bot's authentication token. Requires no parameters. Returns basic information about the bot in form of a User object.

_Sem parâmetros obrigatórios._

[doc oficial](https://core.telegram.org/bots/api#getme)

### `setWebhook` → Boolean

**Uso no projeto:** registrar o endpoint /api/telegram/webhook (Wave 2)

Use this method to specify a URL and receive incoming updates via an outgoing webhook. Whenever there is an update for the bot, we will send an HTTPS POST request to the specified URL, containing a JSON-serialized Update. In case of an unsuccessful request (a request with response HTTP status code different from 2XY), we will repeat the request and give up after a reasonable amount of attempts. Returns True on success.

| param (required) | tipos | descrição |
|---|---|---|
| `url` | `String` | HTTPS URL to send updates to. Use an empty string to remove webhook integration. |

[doc oficial](https://core.telegram.org/bots/api#setwebhook)

### `deleteWebhook` → Boolean

**Uso no projeto:** desregistrar/limpar o webhook

Use this method to remove webhook integration if you decide to switch back to getUpdates. Returns True on success.

_Sem parâmetros obrigatórios._

[doc oficial](https://core.telegram.org/bots/api#deletewebhook)

### `getWebhookInfo` → WebhookInfo

**Uso no projeto:** diagnosticar webhook (URL, pending_update_count, last_error)

Use this method to get current webhook status. Requires no parameters. On success, returns a WebhookInfo object. If the bot is using getUpdates, will return an object with the url field empty.

_Sem parâmetros obrigatórios._

[doc oficial](https://core.telegram.org/bots/api#getwebhookinfo)

### `getUpdates` → Array of Update

**Uso no projeto:** alternativa de polling ao webhook (dev/local)

Use this method to receive incoming updates using long polling (wiki). Returns an Array of Update objects.

_Sem parâmetros obrigatórios._

[doc oficial](https://core.telegram.org/bots/api#getupdates)

### `setMyCommands` → Boolean

**Uso no projeto:** registrar /jogos /reco /banca no menu do bot (Wave 2)

Use this method to change the list of the bot's commands. See this manual for more details about bot commands. Returns True on success.

| param (required) | tipos | descrição |
|---|---|---|
| `commands` | `Array of BotCommand` | A JSON-serialized list of bot commands to be set as the list of the bot's commands. At most 100 commands can be specified. |

[doc oficial](https://core.telegram.org/bots/api#setmycommands)

### `answerCallbackQuery` → Boolean

**Uso no projeto:** responder cliques de botão inline (Wave 2/3)

Use this method to send answers to callback queries sent from inline keyboards. The answer will be displayed to the user as a notification at the top of the chat screen or as an alert. On success, True is returned.

| param (required) | tipos | descrição |
|---|---|---|
| `callback_query_id` | `String` | Unique identifier for the query to be answered |

[doc oficial](https://core.telegram.org/bots/api#answercallbackquery)

### `sendChatAction` → Boolean

**Uso no projeto:** indicador 'digitando…' enquanto a IA-2 processa (Wave 3)

Use this method when you need to tell the user that something is happening on the bot's side. The status is set for 5 seconds or less (when a message arrives from your bot, Telegram clients clear its typing status). Returns True on success.

| param (required) | tipos | descrição |
|---|---|---|
| `chat_id` | `Integer`, `String` | Unique identifier for the target chat or username of the target bot or supergroup in the format @username. Channel chats and channel direct messages chats aren't supported. |
| `action` | `String` | Type of action to broadcast. Choose one, depending on what the user is about to receive: typing for text messages, upload_photo for photos, record_video or upload_video for videos, record_voice or upload_voice for voice notes, upload_document for general files, choose_sticker for stickers, find_location for location data, record_video_note or upload_video_note for video notes. |

[doc oficial](https://core.telegram.org/bots/api#sendchataction)

## Referência completa — Métodos

| método | retorna | descrição |
|---|---|---|
| [`addStickerToSet`](https://core.telegram.org/bots/api#addstickertoset) | `Boolean` | Use this method to add a new sticker to a set created by the bot. Emoji sticker sets can have up to 200 stickers. Other sticker sets can have up to 120 stickers. Returns True on success. |
| [`answerCallbackQuery`](https://core.telegram.org/bots/api#answercallbackquery) | `Boolean` | Use this method to send answers to callback queries sent from inline keyboards. The answer will be displayed to the user as a notification at the top of the chat screen or as an alert. On success, True is returned. |
| [`answerGuestQuery`](https://core.telegram.org/bots/api#answerguestquery) | `SentGuestMessage` | Use this method to reply to a received guest message. On success, a SentGuestMessage object is returned. |
| [`answerInlineQuery`](https://core.telegram.org/bots/api#answerinlinequery) | `Boolean` | Use this method to send answers to an inline query. On success, True is returned. |
| [`answerPreCheckoutQuery`](https://core.telegram.org/bots/api#answerprecheckoutquery) | `Boolean` | Once the user has confirmed their payment and shipping details, the Bot API sends the final confirmation in the form of an Update with the field pre_checkout_query. Use this method to respond to such pre-checkout queries. On success, True is returned. Note: The Bot API must receive an answer within 10 seconds after the pre-checkout query was sent. |
| [`answerShippingQuery`](https://core.telegram.org/bots/api#answershippingquery) | `Boolean` | If you sent an invoice requesting a shipping address and the parameter is_flexible was specified, the Bot API will send an Update with a shipping_query field to the bot. Use this method to reply to shipping queries. On success, True is returned. |
| [`answerWebAppQuery`](https://core.telegram.org/bots/api#answerwebappquery) | `SentWebAppMessage` | Use this method to set the result of an interaction with a Web App and send a corresponding message on behalf of the user to the chat from which the query originated. On success, a SentWebAppMessage object is returned. |
| [`approveChatJoinRequest`](https://core.telegram.org/bots/api#approvechatjoinrequest) | `Boolean` | Use this method to approve a chat join request. The bot must be an administrator in the chat for this to work and must have the can_invite_users administrator right. Returns True on success. |
| [`approveSuggestedPost`](https://core.telegram.org/bots/api#approvesuggestedpost) | `Boolean` | Use this method to approve a suggested post in a direct messages chat. The bot must have the 'can_post_messages' administrator right in the corresponding channel chat. Returns True on success. |
| [`banChatMember`](https://core.telegram.org/bots/api#banchatmember) | `Boolean` | Use this method to ban a user in a group, a supergroup or a channel. In the case of supergroups and channels, the user will not be able to return to the chat on their own using invite links, etc., unless unbanned first. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Returns True on success. |
| [`banChatSenderChat`](https://core.telegram.org/bots/api#banchatsenderchat) | `Boolean` | Use this method to ban a channel chat in a supergroup or a channel. Until the chat is unbanned, the owner of the banned chat won't be able to send messages on behalf of any of their channels. The bot must be an administrator in the supergroup or channel for this to work and must have the appropriate administrator rights. Returns True on success. |
| [`close`](https://core.telegram.org/bots/api#close) | `Boolean` | Use this method to close the bot instance before moving it from one local server to another. You need to delete the webhook before calling this method to ensure that the bot isn't launched again after server restart. The method will return error 429 in the first 10 minutes after the bot is launched. Returns True on success. Requires no parameters. |
| [`closeForumTopic`](https://core.telegram.org/bots/api#closeforumtopic) | `Boolean` | Use this method to close an open topic in a forum supergroup chat. The bot must be an administrator in the chat for this to work and must have the can_manage_topics administrator rights, unless it is the creator of the topic. Returns True on success. |
| [`closeGeneralForumTopic`](https://core.telegram.org/bots/api#closegeneralforumtopic) | `Boolean` | Use this method to close an open 'General' topic in a forum supergroup chat. The bot must be an administrator in the chat for this to work and must have the can_manage_topics administrator rights. Returns True on success. |
| [`convertGiftToStars`](https://core.telegram.org/bots/api#convertgifttostars) | `Boolean` | Converts a given regular gift to Telegram Stars. Requires the can_convert_gifts_to_stars business bot right. Returns True on success. |
| [`copyMessage`](https://core.telegram.org/bots/api#copymessage) | `MessageId` | Use this method to copy messages of any kind. Service messages, paid media messages, giveaway messages, giveaway winners messages, and invoice messages can't be copied. A quiz poll can be copied only if the value of the field correct_option_id is known to the bot. The method is analogous to the method forwardMessage, but the copied message doesn't have a link to the original message. Returns the MessageId of the sent message on success. |
| [`copyMessages`](https://core.telegram.org/bots/api#copymessages) | `Array of MessageId` | Use this method to copy messages of any kind. If some of the specified messages can't be found or copied, they are skipped. Service messages, paid media messages, giveaway messages, giveaway winners messages, and invoice messages can't be copied. A quiz poll can be copied only if the value of the field correct_option_id is known to the bot. The method is analogous to the method forwardMessages, but the copied messages don't have a link to the original message. Album grouping is kept for copied messages. On success, an array of MessageId of the sent messages is returned. |
| [`createChatInviteLink`](https://core.telegram.org/bots/api#createchatinvitelink) | `ChatInviteLink` | Use this method to create an additional invite link for a chat. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. The link can be revoked using the method revokeChatInviteLink. Returns the new invite link as ChatInviteLink object. |
| [`createChatSubscriptionInviteLink`](https://core.telegram.org/bots/api#createchatsubscriptioninvitelink) | `ChatInviteLink` | Use this method to create a subscription invite link for a channel chat. The bot must have the can_invite_users administrator rights. The link can be edited using the method editChatSubscriptionInviteLink or revoked using the method revokeChatInviteLink. Returns the new invite link as a ChatInviteLink object. |
| [`createForumTopic`](https://core.telegram.org/bots/api#createforumtopic) | `ForumTopic` | Use this method to create a topic in a forum supergroup chat or a private chat with a user. In the case of a supergroup chat the bot must be an administrator in the chat for this to work and must have the can_manage_topics administrator right. Returns information about the created topic as a ForumTopic object. |
| [`createInvoiceLink`](https://core.telegram.org/bots/api#createinvoicelink) | `String` | Use this method to create a link for an invoice. Returns the created invoice link as String on success. |
| [`createNewStickerSet`](https://core.telegram.org/bots/api#createnewstickerset) | `Boolean` | Use this method to create a new sticker set owned by a user. The bot will be able to edit the sticker set thus created. Returns True on success. |
| [`declineChatJoinRequest`](https://core.telegram.org/bots/api#declinechatjoinrequest) | `Boolean` | Use this method to decline a chat join request. The bot must be an administrator in the chat for this to work and must have the can_invite_users administrator right. Returns True on success. |
| [`declineSuggestedPost`](https://core.telegram.org/bots/api#declinesuggestedpost) | `Boolean` | Use this method to decline a suggested post in a direct messages chat. The bot must have the 'can_manage_direct_messages' administrator right in the corresponding channel chat. Returns True on success. |
| [`deleteAllMessageReactions`](https://core.telegram.org/bots/api#deleteallmessagereactions) | `Boolean` | Use this method to remove up to 10000 recent reactions in a group or a supergroup chat added by a given user or chat. The bot must have the 'can_delete_messages' administrator right in the chat. Returns True on success. |
| [`deleteBusinessMessages`](https://core.telegram.org/bots/api#deletebusinessmessages) | `Boolean` | Delete messages on behalf of a business account. Requires the can_delete_sent_messages business bot right to delete messages sent by the bot itself, or the can_delete_all_messages business bot right to delete any message. Returns True on success. |
| [`deleteChatPhoto`](https://core.telegram.org/bots/api#deletechatphoto) | `Boolean` | Use this method to delete a chat photo. Photos can't be changed for private chats. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Returns True on success. |
| [`deleteChatStickerSet`](https://core.telegram.org/bots/api#deletechatstickerset) | `Boolean` | Use this method to delete a group sticker set from a supergroup. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Use the field can_set_sticker_set optionally returned in getChat requests to check if the bot can use this method. Returns True on success. |
| [`deleteForumTopic`](https://core.telegram.org/bots/api#deleteforumtopic) | `Boolean` | Use this method to delete a forum topic along with all its messages in a forum supergroup chat or a private chat with a user. In the case of a supergroup chat the bot must be an administrator in the chat for this to work and must have the can_delete_messages administrator rights. Returns True on success. |
| [`deleteMessage`](https://core.telegram.org/bots/api#deletemessage) | `Boolean` | Use this method to delete a message, including service messages, with the following limitations: |
| [`deleteMessageReaction`](https://core.telegram.org/bots/api#deletemessagereaction) | `Boolean` | Use this method to remove a reaction from a message in a group or a supergroup chat. The bot must have the 'can_delete_messages' administrator right in the chat. Returns True on success. |
| [`deleteMessages`](https://core.telegram.org/bots/api#deletemessages) | `Boolean` | Use this method to delete multiple messages simultaneously. If some of the specified messages can't be found, they are skipped. Returns True on success. |
| [`deleteMyCommands`](https://core.telegram.org/bots/api#deletemycommands) | `Boolean` | Use this method to delete the list of the bot's commands for the given scope and user language. After deletion, higher level commands will be shown to affected users. Returns True on success. |
| [`deleteStickerFromSet`](https://core.telegram.org/bots/api#deletestickerfromset) | `Boolean` | Use this method to delete a sticker from a set created by the bot. Returns True on success. |
| [`deleteStickerSet`](https://core.telegram.org/bots/api#deletestickerset) | `Boolean` | Use this method to delete a sticker set that was created by the bot. Returns True on success. |
| [`deleteStory`](https://core.telegram.org/bots/api#deletestory) | `Boolean` | Deletes a story previously posted by the bot on behalf of a managed business account. Requires the can_manage_stories business bot right. Returns True on success. |
| [`deleteWebhook`](https://core.telegram.org/bots/api#deletewebhook) | `Boolean` | Use this method to remove webhook integration if you decide to switch back to getUpdates. Returns True on success. |
| [`editChatInviteLink`](https://core.telegram.org/bots/api#editchatinvitelink) | `ChatInviteLink` | Use this method to edit a non-primary invite link created by the bot. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Returns the edited invite link as a ChatInviteLink object. |
| [`editChatSubscriptionInviteLink`](https://core.telegram.org/bots/api#editchatsubscriptioninvitelink) | `ChatInviteLink` | Use this method to edit a subscription invite link created by the bot. The bot must have the can_invite_users administrator rights. Returns the edited invite link as a ChatInviteLink object. |
| [`editForumTopic`](https://core.telegram.org/bots/api#editforumtopic) | `Boolean` | Use this method to edit name and icon of a topic in a forum supergroup chat or a private chat with a user. In the case of a supergroup chat the bot must be an administrator in the chat for this to work and must have the can_manage_topics administrator rights, unless it is the creator of the topic. Returns True on success. |
| [`editGeneralForumTopic`](https://core.telegram.org/bots/api#editgeneralforumtopic) | `Boolean` | Use this method to edit the name of the 'General' topic in a forum supergroup chat. The bot must be an administrator in the chat for this to work and must have the can_manage_topics administrator rights. Returns True on success. |
| [`editMessageCaption`](https://core.telegram.org/bots/api#editmessagecaption) | `Message` \| `Boolean` | Use this method to edit captions of messages. On success, if the edited message is not an inline message, the edited Message is returned, otherwise True is returned. Note that business messages that were not sent by the bot and do not contain an inline keyboard can only be edited within 48 hours from the time they were sent. |
| [`editMessageChecklist`](https://core.telegram.org/bots/api#editmessagechecklist) | `Message` | Use this method to edit a checklist on behalf of a connected business account. On success, the edited Message is returned. |
| [`editMessageLiveLocation`](https://core.telegram.org/bots/api#editmessagelivelocation) | `Message` \| `Boolean` | Use this method to edit live location messages. A location can be edited until its live_period expires or editing is explicitly disabled by a call to stopMessageLiveLocation. On success, if the edited message is not an inline message, the edited Message is returned, otherwise True is returned. |
| [`editMessageMedia`](https://core.telegram.org/bots/api#editmessagemedia) | `Message` \| `Boolean` | Use this method to edit animation, audio, document, live photo, photo, or video messages, or to add media to text messages. If a message is part of a message album, then it can be edited only to an audio for audio albums, only to a document for document albums and to a photo, a live photo, or a video otherwise. When an inline message is edited, a new file can't be uploaded; use a previously uploaded file via its file_id or specify a URL. On success, if the edited message is not an inline message, the edited Message is returned, otherwise True is returned. Note that business messages that were not sent by the bot and do not contain an inline keyboard can only be edited within 48 hours from the time they were sent. |
| [`editMessageReplyMarkup`](https://core.telegram.org/bots/api#editmessagereplymarkup) | `Message` \| `Boolean` | Use this method to edit only the reply markup of messages. On success, if the edited message is not an inline message, the edited Message is returned, otherwise True is returned. Note that business messages that were not sent by the bot and do not contain an inline keyboard can only be edited within 48 hours from the time they were sent. |
| [`editMessageText`](https://core.telegram.org/bots/api#editmessagetext) | `Message` \| `Boolean` | Use this method to edit text and game messages. On success, if the edited message is not an inline message, the edited Message is returned, otherwise True is returned. Note that business messages that were not sent by the bot and do not contain an inline keyboard can only be edited within 48 hours from the time they were sent. |
| [`editStory`](https://core.telegram.org/bots/api#editstory) | `Story` | Edits a story previously posted by the bot on behalf of a managed business account. Requires the can_manage_stories business bot right. Returns Story on success. |
| [`editUserStarSubscription`](https://core.telegram.org/bots/api#edituserstarsubscription) | `Boolean` | Allows the bot to cancel or re-enable extension of a subscription paid in Telegram Stars. Returns True on success. |
| [`exportChatInviteLink`](https://core.telegram.org/bots/api#exportchatinvitelink) | `String` | Use this method to generate a new primary invite link for a chat; any previously generated primary link is revoked. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Returns the new invite link as String on success. |
| [`forwardMessage`](https://core.telegram.org/bots/api#forwardmessage) | `Message` | Use this method to forward messages of any kind. Service messages and messages with protected content can't be forwarded. On success, the sent Message is returned. |
| [`forwardMessages`](https://core.telegram.org/bots/api#forwardmessages) | `Array of MessageId` | Use this method to forward multiple messages of any kind. If some of the specified messages can't be found or forwarded, they are skipped. Service messages and messages with protected content can't be forwarded. Album grouping is kept for forwarded messages. On success, an array of MessageId of the sent messages is returned. |
| [`getAvailableGifts`](https://core.telegram.org/bots/api#getavailablegifts) | `Gifts` | Returns the list of gifts that can be sent by the bot to users and channel chats. Requires no parameters. Returns a Gifts object. |
| [`getBusinessAccountGifts`](https://core.telegram.org/bots/api#getbusinessaccountgifts) | `OwnedGifts` | Returns the gifts received and owned by a managed business account. Requires the can_view_gifts_and_stars business bot right. Returns OwnedGifts on success. |
| [`getBusinessAccountStarBalance`](https://core.telegram.org/bots/api#getbusinessaccountstarbalance) | `StarAmount` | Returns the amount of Telegram Stars owned by a managed business account. Requires the can_view_gifts_and_stars business bot right. Returns StarAmount on success. |
| [`getBusinessConnection`](https://core.telegram.org/bots/api#getbusinessconnection) | `BusinessConnection` | Use this method to get information about the connection of the bot with a business account. Returns a BusinessConnection object on success. |
| [`getChat`](https://core.telegram.org/bots/api#getchat) | `ChatFullInfo` | Use this method to get up-to-date information about the chat. Returns a ChatFullInfo object on success. |
| [`getChatAdministrators`](https://core.telegram.org/bots/api#getchatadministrators) | `Array of ChatMember` | Use this method to get a list of administrators in a chat. Returns an Array of ChatMember objects. |
| [`getChatGifts`](https://core.telegram.org/bots/api#getchatgifts) | `OwnedGifts` | Returns the gifts owned by a chat. Returns OwnedGifts on success. |
| [`getChatMember`](https://core.telegram.org/bots/api#getchatmember) | `ChatMember` | Use this method to get information about a member of a chat. The method is only guaranteed to work for other users if the bot is an administrator in the chat. Returns a ChatMember object on success. |
| [`getChatMemberCount`](https://core.telegram.org/bots/api#getchatmembercount) | `Integer` | Use this method to get the number of members in a chat. Returns Int on success. |
| [`getChatMenuButton`](https://core.telegram.org/bots/api#getchatmenubutton) | `MenuButton` | Use this method to get the current value of the bot's menu button in a private chat, or the default menu button. Returns MenuButton on success. |
| [`getCustomEmojiStickers`](https://core.telegram.org/bots/api#getcustomemojistickers) | `Array of Sticker` | Use this method to get information about custom emoji stickers by their identifiers. Returns an Array of Sticker objects. |
| [`getFile`](https://core.telegram.org/bots/api#getfile) | `File` | Use this method to get basic information about a file and prepare it for downloading. For the moment, bots can download files of up to 20MB in size. On success, a File object is returned. The file can then be downloaded via the link https://api.telegram.org/file/bot<token>/<file_path>, where <file_path> is taken from the response. It is guaranteed that the link will be valid for at least 1 hour. When the link expires, a new one can be requested by calling getFile again. |
| [`getForumTopicIconStickers`](https://core.telegram.org/bots/api#getforumtopiciconstickers) | `Array of Sticker` | Use this method to get custom emoji stickers, which can be used as a forum topic icon by any user. Requires no parameters. Returns an Array of Sticker objects. |
| [`getGameHighScores`](https://core.telegram.org/bots/api#getgamehighscores) | `Array of GameHighScore` | Use this method to get data for high score tables. Will return the score of the specified user and several of their neighbors in a game. Returns an Array of GameHighScore objects. |
| [`getManagedBotAccessSettings`](https://core.telegram.org/bots/api#getmanagedbotaccesssettings) | `BotAccessSettings` | Use this method to get the access settings of a managed bot. Returns a BotAccessSettings object on success. |
| [`getManagedBotToken`](https://core.telegram.org/bots/api#getmanagedbottoken) | `String` | Use this method to get the token of a managed bot. Returns the token as String on success. |
| [`getMe`](https://core.telegram.org/bots/api#getme) | `User` | A simple method for testing your bot's authentication token. Requires no parameters. Returns basic information about the bot in form of a User object. |
| [`getMyCommands`](https://core.telegram.org/bots/api#getmycommands) | `Array of BotCommand` | Use this method to get the current list of the bot's commands for the given scope and user language. Returns an Array of BotCommand objects. If commands aren't set, an empty list is returned. |
| [`getMyDefaultAdministratorRights`](https://core.telegram.org/bots/api#getmydefaultadministratorrights) | `ChatAdministratorRights` | Use this method to get the current default administrator rights of the bot. Returns ChatAdministratorRights on success. |
| [`getMyDescription`](https://core.telegram.org/bots/api#getmydescription) | `BotDescription` | Use this method to get the current bot description for the given user language. Returns BotDescription on success. |
| [`getMyName`](https://core.telegram.org/bots/api#getmyname) | `BotName` | Use this method to get the current bot name for the given user language. Returns BotName on success. |
| [`getMyShortDescription`](https://core.telegram.org/bots/api#getmyshortdescription) | `BotShortDescription` | Use this method to get the current bot short description for the given user language. Returns BotShortDescription on success. |
| [`getMyStarBalance`](https://core.telegram.org/bots/api#getmystarbalance) | `StarAmount` | A method to get the current Telegram Stars balance of the bot. Requires no parameters. On success, returns a StarAmount object. |
| [`getStarTransactions`](https://core.telegram.org/bots/api#getstartransactions) | `StarTransactions` | Returns the bot's Telegram Star transactions in chronological order. On success, returns a StarTransactions object. |
| [`getStickerSet`](https://core.telegram.org/bots/api#getstickerset) | `StickerSet` | Use this method to get a sticker set. On success, a StickerSet object is returned. |
| [`getUpdates`](https://core.telegram.org/bots/api#getupdates) | `Array of Update` | Use this method to receive incoming updates using long polling (wiki). Returns an Array of Update objects. |
| [`getUserChatBoosts`](https://core.telegram.org/bots/api#getuserchatboosts) | `UserChatBoosts` | Use this method to get the list of boosts added to a chat by a user. Requires administrator rights in the chat. Returns a UserChatBoosts object. |
| [`getUserGifts`](https://core.telegram.org/bots/api#getusergifts) | `OwnedGifts` | Returns the gifts owned and hosted by a user. Returns OwnedGifts on success. |
| [`getUserPersonalChatMessages`](https://core.telegram.org/bots/api#getuserpersonalchatmessages) | `Array of Message` | Use this method to get the last messages from the personal chat (i.e., the chat currently added to their profile) of a given user. On success, an array of Message objects is returned. |
| [`getUserProfileAudios`](https://core.telegram.org/bots/api#getuserprofileaudios) | `UserProfileAudios` | Use this method to get a list of profile audios for a user. Returns a UserProfileAudios object. |
| [`getUserProfilePhotos`](https://core.telegram.org/bots/api#getuserprofilephotos) | `UserProfilePhotos` | Use this method to get a list of profile pictures for a user. Returns a UserProfilePhotos object. |
| [`getWebhookInfo`](https://core.telegram.org/bots/api#getwebhookinfo) | `WebhookInfo` | Use this method to get current webhook status. Requires no parameters. On success, returns a WebhookInfo object. If the bot is using getUpdates, will return an object with the url field empty. |
| [`giftPremiumSubscription`](https://core.telegram.org/bots/api#giftpremiumsubscription) | `Boolean` | Gifts a Telegram Premium subscription to the given user. Returns True on success. |
| [`hideGeneralForumTopic`](https://core.telegram.org/bots/api#hidegeneralforumtopic) | `Boolean` | Use this method to hide the 'General' topic in a forum supergroup chat. The bot must be an administrator in the chat for this to work and must have the can_manage_topics administrator rights. The topic will be automatically closed if it was open. Returns True on success. |
| [`leaveChat`](https://core.telegram.org/bots/api#leavechat) | `Boolean` | Use this method for your bot to leave a group, supergroup or channel. Returns True on success. |
| [`logOut`](https://core.telegram.org/bots/api#logout) | `Boolean` | Use this method to log out from the cloud Bot API server before launching the bot locally. You must log out the bot before running it locally, otherwise there is no guarantee that the bot will receive updates. After a successful call, you can immediately log in on a local server, but will not be able to log in back to the cloud Bot API server for 10 minutes. Returns True on success. Requires no parameters. |
| [`pinChatMessage`](https://core.telegram.org/bots/api#pinchatmessage) | `Boolean` | Use this method to add a message to the list of pinned messages in a chat. In private chats and channel direct messages chats, all non-service messages can be pinned. Conversely, the bot must be an administrator with the 'can_pin_messages' right or the 'can_edit_messages' right to pin messages in groups and channels respectively. Returns True on success. |
| [`postStory`](https://core.telegram.org/bots/api#poststory) | `Story` | Posts a story on behalf of a managed business account. Requires the can_manage_stories business bot right. Returns Story on success. |
| [`promoteChatMember`](https://core.telegram.org/bots/api#promotechatmember) | `Boolean` | Use this method to promote or demote a user in a supergroup or a channel. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Pass False for all boolean parameters to demote a user. Returns True on success. |
| [`readBusinessMessage`](https://core.telegram.org/bots/api#readbusinessmessage) | `Boolean` | Marks incoming message as read on behalf of a business account. Requires the can_read_messages business bot right. Returns True on success. |
| [`refundStarPayment`](https://core.telegram.org/bots/api#refundstarpayment) | `Boolean` | Refunds a successful payment in Telegram Stars. Returns True on success. |
| [`removeBusinessAccountProfilePhoto`](https://core.telegram.org/bots/api#removebusinessaccountprofilephoto) | `Boolean` | Removes the current profile photo of a managed business account. Requires the can_edit_profile_photo business bot right. Returns True on success. |
| [`removeChatVerification`](https://core.telegram.org/bots/api#removechatverification) | `Boolean` | Removes verification from a chat that is currently verified on behalf of the organization represented by the bot. Returns True on success. |
| [`removeMyProfilePhoto`](https://core.telegram.org/bots/api#removemyprofilephoto) | `Boolean` | Removes the profile photo of the bot. Requires no parameters. Returns True on success. |
| [`removeUserVerification`](https://core.telegram.org/bots/api#removeuserverification) | `Boolean` | Removes verification from a user who is currently verified on behalf of the organization represented by the bot. Returns True on success. |
| [`reopenForumTopic`](https://core.telegram.org/bots/api#reopenforumtopic) | `Boolean` | Use this method to reopen a closed topic in a forum supergroup chat. The bot must be an administrator in the chat for this to work and must have the can_manage_topics administrator rights, unless it is the creator of the topic. Returns True on success. |
| [`reopenGeneralForumTopic`](https://core.telegram.org/bots/api#reopengeneralforumtopic) | `Boolean` | Use this method to reopen a closed 'General' topic in a forum supergroup chat. The bot must be an administrator in the chat for this to work and must have the can_manage_topics administrator rights. The topic will be automatically unhidden if it was hidden. Returns True on success. |
| [`replaceManagedBotToken`](https://core.telegram.org/bots/api#replacemanagedbottoken) | `String` | Use this method to revoke the current token of a managed bot and generate a new one. Returns the new token as String on success. |
| [`replaceStickerInSet`](https://core.telegram.org/bots/api#replacestickerinset) | `Boolean` | Use this method to replace an existing sticker in a sticker set with a new one. The method is equivalent to calling deleteStickerFromSet, then addStickerToSet, then setStickerPositionInSet. Returns True on success. |
| [`repostStory`](https://core.telegram.org/bots/api#repoststory) | `Story` | Reposts a story on behalf of a business account from another business account. Both business accounts must be managed by the same bot, and the story on the source account must have been posted (or reposted) by the bot. Requires the can_manage_stories business bot right for both business accounts. Returns Story on success. |
| [`restrictChatMember`](https://core.telegram.org/bots/api#restrictchatmember) | `Boolean` | Use this method to restrict a user in a supergroup. The bot must be an administrator in the supergroup for this to work and must have the appropriate administrator rights. Pass True for all permissions to lift restrictions from a user. Returns True on success. |
| [`revokeChatInviteLink`](https://core.telegram.org/bots/api#revokechatinvitelink) | `ChatInviteLink` | Use this method to revoke an invite link created by the bot. If the primary link is revoked, a new link is automatically generated. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Returns the revoked invite link as ChatInviteLink object. |
| [`savePreparedInlineMessage`](https://core.telegram.org/bots/api#savepreparedinlinemessage) | `PreparedInlineMessage` | Stores a message that can be sent by a user of a Mini App. Returns a PreparedInlineMessage object. |
| [`savePreparedKeyboardButton`](https://core.telegram.org/bots/api#savepreparedkeyboardbutton) | `PreparedKeyboardButton` | Stores a keyboard button that can be used by a user within a Mini App. Returns a PreparedKeyboardButton object. |
| [`sendAnimation`](https://core.telegram.org/bots/api#sendanimation) | `Message` | Use this method to send animation files (GIF or H.264/MPEG-4 AVC video without sound). On success, the sent Message is returned. Bots can currently send animation files of up to 50 MB in size, this limit may be changed in the future. |
| [`sendAudio`](https://core.telegram.org/bots/api#sendaudio) | `Message` | Use this method to send audio files, if you want Telegram clients to display them in the music player. Your audio must be in the .MP3 or .M4A format. On success, the sent Message is returned. Bots can currently send audio files of up to 50 MB in size, this limit may be changed in the future. |
| [`sendChatAction`](https://core.telegram.org/bots/api#sendchataction) | `Boolean` | Use this method when you need to tell the user that something is happening on the bot's side. The status is set for 5 seconds or less (when a message arrives from your bot, Telegram clients clear its typing status). Returns True on success. |
| [`sendChecklist`](https://core.telegram.org/bots/api#sendchecklist) | `Message` | Use this method to send a checklist on behalf of a connected business account. On success, the sent Message is returned. |
| [`sendContact`](https://core.telegram.org/bots/api#sendcontact) | `Message` | Use this method to send phone contacts. On success, the sent Message is returned. |
| [`sendDice`](https://core.telegram.org/bots/api#senddice) | `Message` | Use this method to send an animated emoji that will display a random value. On success, the sent Message is returned. |
| [`sendDocument`](https://core.telegram.org/bots/api#senddocument) | `Message` | Use this method to send general files. On success, the sent Message is returned. Bots can currently send files of any type of up to 50 MB in size, this limit may be changed in the future. |
| [`sendGame`](https://core.telegram.org/bots/api#sendgame) | `Message` | Use this method to send a game. On success, the sent Message is returned. |
| [`sendGift`](https://core.telegram.org/bots/api#sendgift) | `Boolean` | Sends a gift to the given user or channel chat. The gift can't be converted to Telegram Stars by the receiver. Returns True on success. |
| [`sendInvoice`](https://core.telegram.org/bots/api#sendinvoice) | `Message` | Use this method to send invoices. On success, the sent Message is returned. |
| [`sendLivePhoto`](https://core.telegram.org/bots/api#sendlivephoto) | `Message` | Use this method to send live photos. On success, the sent Message is returned. |
| [`sendLocation`](https://core.telegram.org/bots/api#sendlocation) | `Message` | Use this method to send point on the map. On success, the sent Message is returned. |
| [`sendMediaGroup`](https://core.telegram.org/bots/api#sendmediagroup) | `Array of Message` | Use this method to send a group of photos, live photos, videos, documents or audios as an album. Documents and audio files can be only grouped in an album with messages of the same type. On success, an array of Message objects that were sent is returned. |
| [`sendMessage`](https://core.telegram.org/bots/api#sendmessage) | `Message` | Use this method to send text messages. On success, the sent Message is returned. |
| [`sendMessageDraft`](https://core.telegram.org/bots/api#sendmessagedraft) | `Boolean` | Use this method to stream a partial message to a user while the message is being generated. Note that the streamed draft is ephemeral and acts as a temporary 30-second preview - once the output is finalized, you must call sendMessage with the complete message to persist it in the user's chat. Returns True on success. |
| [`sendPaidMedia`](https://core.telegram.org/bots/api#sendpaidmedia) | `Message` | Use this method to send paid media. On success, the sent Message is returned. |
| [`sendPhoto`](https://core.telegram.org/bots/api#sendphoto) | `Message` | Use this method to send photos. On success, the sent Message is returned. |
| [`sendPoll`](https://core.telegram.org/bots/api#sendpoll) | `Message` | Use this method to send a native poll. On success, the sent Message is returned. |
| [`sendSticker`](https://core.telegram.org/bots/api#sendsticker) | `Message` | Use this method to send static .WEBP, animated .TGS, or video .WEBM stickers. On success, the sent Message is returned. |
| [`sendVenue`](https://core.telegram.org/bots/api#sendvenue) | `Message` | Use this method to send information about a venue. On success, the sent Message is returned. |
| [`sendVideo`](https://core.telegram.org/bots/api#sendvideo) | `Message` | Use this method to send video files, Telegram clients support MPEG4 videos (other formats may be sent as Document). On success, the sent Message is returned. Bots can currently send video files of up to 50 MB in size, this limit may be changed in the future. |
| [`sendVideoNote`](https://core.telegram.org/bots/api#sendvideonote) | `Message` | As of v.4.0, Telegram clients support rounded square MPEG4 videos of up to 1 minute long. Use this method to send video messages. On success, the sent Message is returned. |
| [`sendVoice`](https://core.telegram.org/bots/api#sendvoice) | `Message` | Use this method to send audio files, if you want Telegram clients to display the file as a playable voice message. For this to work, your audio must be in an .OGG file encoded with OPUS, or in .MP3 format, or in .M4A format (other formats may be sent as Audio or Document). On success, the sent Message is returned. Bots can currently send voice messages of up to 50 MB in size, this limit may be changed in the future. |
| [`setBusinessAccountBio`](https://core.telegram.org/bots/api#setbusinessaccountbio) | `Boolean` | Changes the bio of a managed business account. Requires the can_change_bio business bot right. Returns True on success. |
| [`setBusinessAccountGiftSettings`](https://core.telegram.org/bots/api#setbusinessaccountgiftsettings) | `Boolean` | Changes the privacy settings pertaining to incoming gifts in a managed business account. Requires the can_change_gift_settings business bot right. Returns True on success. |
| [`setBusinessAccountName`](https://core.telegram.org/bots/api#setbusinessaccountname) | `Boolean` | Changes the first and last name of a managed business account. Requires the can_change_name business bot right. Returns True on success. |
| [`setBusinessAccountProfilePhoto`](https://core.telegram.org/bots/api#setbusinessaccountprofilephoto) | `Boolean` | Changes the profile photo of a managed business account. Requires the can_edit_profile_photo business bot right. Returns True on success. |
| [`setBusinessAccountUsername`](https://core.telegram.org/bots/api#setbusinessaccountusername) | `Boolean` | Changes the username of a managed business account. Requires the can_change_username business bot right. Returns True on success. |
| [`setChatAdministratorCustomTitle`](https://core.telegram.org/bots/api#setchatadministratorcustomtitle) | `Boolean` | Use this method to set a custom title for an administrator in a supergroup promoted by the bot. Returns True on success. |
| [`setChatDescription`](https://core.telegram.org/bots/api#setchatdescription) | `Boolean` | Use this method to change the description of a group, a supergroup or a channel. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Returns True on success. |
| [`setChatMemberTag`](https://core.telegram.org/bots/api#setchatmembertag) | `Boolean` | Use this method to set a tag for a regular member in a group or a supergroup. The bot must be an administrator in the chat for this to work and must have the can_manage_tags administrator right. Returns True on success. |
| [`setChatMenuButton`](https://core.telegram.org/bots/api#setchatmenubutton) | `Boolean` | Use this method to change the bot's menu button in a private chat, or the default menu button. Returns True on success. |
| [`setChatPermissions`](https://core.telegram.org/bots/api#setchatpermissions) | `Boolean` | Use this method to set default chat permissions for all members. The bot must be an administrator in the group or a supergroup for this to work and must have the can_restrict_members administrator rights. Returns True on success. |
| [`setChatPhoto`](https://core.telegram.org/bots/api#setchatphoto) | `Boolean` | Use this method to set a new profile photo for the chat. Photos can't be changed for private chats. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Returns True on success. |
| [`setChatStickerSet`](https://core.telegram.org/bots/api#setchatstickerset) | `Boolean` | Use this method to set a new group sticker set for a supergroup. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Use the field can_set_sticker_set optionally returned in getChat requests to check if the bot can use this method. Returns True on success. |
| [`setChatTitle`](https://core.telegram.org/bots/api#setchattitle) | `Boolean` | Use this method to change the title of a chat. Titles can't be changed for private chats. The bot must be an administrator in the chat for this to work and must have the appropriate administrator rights. Returns True on success. |
| [`setCustomEmojiStickerSetThumbnail`](https://core.telegram.org/bots/api#setcustomemojistickersetthumbnail) | `Boolean` | Use this method to set the thumbnail of a custom emoji sticker set. Returns True on success. |
| [`setGameScore`](https://core.telegram.org/bots/api#setgamescore) | `Message` \| `Boolean` | Use this method to set the score of the specified user in a game message. On success, if the message is not an inline message, the Message is returned, otherwise True is returned. Returns an error, if the new score is not greater than the user's current score in the chat and force is False. |
| [`setManagedBotAccessSettings`](https://core.telegram.org/bots/api#setmanagedbotaccesssettings) | `Boolean` | Use this method to change the access settings of a managed bot. Returns True on success. |
| [`setMessageReaction`](https://core.telegram.org/bots/api#setmessagereaction) | `Boolean` | Use this method to change the chosen reactions on a message. Service messages of some types can't be reacted to. Automatically forwarded messages from a channel to its discussion group have the same available reactions as messages in the channel. Bots can't use paid reactions. Returns True on success. |
| [`setMyCommands`](https://core.telegram.org/bots/api#setmycommands) | `Boolean` | Use this method to change the list of the bot's commands. See this manual for more details about bot commands. Returns True on success. |
| [`setMyDefaultAdministratorRights`](https://core.telegram.org/bots/api#setmydefaultadministratorrights) | `Boolean` | Use this method to change the default administrator rights requested by the bot when it's added as an administrator to groups or channels. These rights will be suggested to users, but they are free to modify the list before adding the bot. Returns True on success. |
| [`setMyDescription`](https://core.telegram.org/bots/api#setmydescription) | `Boolean` | Use this method to change the bot's description, which is shown in the chat with the bot if the chat is empty. Returns True on success. |
| [`setMyName`](https://core.telegram.org/bots/api#setmyname) | `Boolean` | Use this method to change the bot's name. Returns True on success. |
| [`setMyProfilePhoto`](https://core.telegram.org/bots/api#setmyprofilephoto) | `Boolean` | Changes the profile photo of the bot. Returns True on success. |
| [`setMyShortDescription`](https://core.telegram.org/bots/api#setmyshortdescription) | `Boolean` | Use this method to change the bot's short description, which is shown on the bot's profile page and is sent together with the link when users share the bot. Returns True on success. |
| [`setPassportDataErrors`](https://core.telegram.org/bots/api#setpassportdataerrors) | `Boolean` | Informs a user that some of the Telegram Passport elements they provided contains errors. The user will not be able to re-submit their Passport to you until the errors are fixed (the contents of the field for which you returned the error must change). Returns True on success. |
| [`setStickerEmojiList`](https://core.telegram.org/bots/api#setstickeremojilist) | `Boolean` | Use this method to change the list of emoji assigned to a regular or custom emoji sticker. The sticker must belong to a sticker set created by the bot. Returns True on success. |
| [`setStickerKeywords`](https://core.telegram.org/bots/api#setstickerkeywords) | `Boolean` | Use this method to change search keywords assigned to a regular or custom emoji sticker. The sticker must belong to a sticker set created by the bot. Returns True on success. |
| [`setStickerMaskPosition`](https://core.telegram.org/bots/api#setstickermaskposition) | `Boolean` | Use this method to change the mask position of a mask sticker. The sticker must belong to a sticker set that was created by the bot. Returns True on success. |
| [`setStickerPositionInSet`](https://core.telegram.org/bots/api#setstickerpositioninset) | `Boolean` | Use this method to move a sticker in a set created by the bot to a specific position. Returns True on success. |
| [`setStickerSetThumbnail`](https://core.telegram.org/bots/api#setstickersetthumbnail) | `Boolean` | Use this method to set the thumbnail of a regular or mask sticker set. The format of the thumbnail file must match the format of the stickers in the set. Returns True on success. |
| [`setStickerSetTitle`](https://core.telegram.org/bots/api#setstickersettitle) | `Boolean` | Use this method to set the title of a created sticker set. Returns True on success. |
| [`setUserEmojiStatus`](https://core.telegram.org/bots/api#setuseremojistatus) | `Boolean` | Changes the emoji status for a given user that previously allowed the bot to manage their emoji status via the Mini App method requestEmojiStatusAccess. Returns True on success. |
| [`setWebhook`](https://core.telegram.org/bots/api#setwebhook) | `Boolean` | Use this method to specify a URL and receive incoming updates via an outgoing webhook. Whenever there is an update for the bot, we will send an HTTPS POST request to the specified URL, containing a JSON-serialized Update. In case of an unsuccessful request (a request with response HTTP status code different from 2XY), we will repeat the request and give up after a reasonable amount of attempts. Returns True on success. |
| [`stopMessageLiveLocation`](https://core.telegram.org/bots/api#stopmessagelivelocation) | `Message` \| `Boolean` | Use this method to stop updating a live location message before live_period expires. On success, if the message is not an inline message, the edited Message is returned, otherwise True is returned. |
| [`stopPoll`](https://core.telegram.org/bots/api#stoppoll) | `Poll` | Use this method to stop a poll which was sent by the bot. On success, the stopped Poll is returned. |
| [`transferBusinessAccountStars`](https://core.telegram.org/bots/api#transferbusinessaccountstars) | `Boolean` | Transfers Telegram Stars from the business account balance to the bot's balance. Requires the can_transfer_stars business bot right. Returns True on success. |
| [`transferGift`](https://core.telegram.org/bots/api#transfergift) | `Boolean` | Transfers an owned unique gift to another user. Requires the can_transfer_and_upgrade_gifts business bot right. Requires can_transfer_stars business bot right if the transfer is paid. Returns True on success. |
| [`unbanChatMember`](https://core.telegram.org/bots/api#unbanchatmember) | `Boolean` | Use this method to unban a previously banned user in a supergroup or channel. The user will not return to the group or channel automatically, but will be able to join via link, etc. The bot must be an administrator for this to work. By default, this method guarantees that after the call the user is not a member of the chat, but will be able to join it. So if the user is a member of the chat they will also be removed from the chat. If you don't want this, use the parameter only_if_banned. Returns True on success. |
| [`unbanChatSenderChat`](https://core.telegram.org/bots/api#unbanchatsenderchat) | `Boolean` | Use this method to unban a previously banned channel chat in a supergroup or channel. The bot must be an administrator for this to work and must have the appropriate administrator rights. Returns True on success. |
| [`unhideGeneralForumTopic`](https://core.telegram.org/bots/api#unhidegeneralforumtopic) | `Boolean` | Use this method to unhide the 'General' topic in a forum supergroup chat. The bot must be an administrator in the chat for this to work and must have the can_manage_topics administrator rights. Returns True on success. |
| [`unpinAllChatMessages`](https://core.telegram.org/bots/api#unpinallchatmessages) | `Boolean` | Use this method to clear the list of pinned messages in a chat. In private chats and channel direct messages chats, no additional rights are required to unpin all pinned messages. Conversely, the bot must be an administrator with the 'can_pin_messages' right or the 'can_edit_messages' right to unpin all pinned messages in groups and channels respectively. Returns True on success. |
| [`unpinAllForumTopicMessages`](https://core.telegram.org/bots/api#unpinallforumtopicmessages) | `Boolean` | Use this method to clear the list of pinned messages in a forum topic in a forum supergroup chat or a private chat with a user. In the case of a supergroup chat the bot must be an administrator in the chat for this to work and must have the can_pin_messages administrator right in the supergroup. Returns True on success. |
| [`unpinAllGeneralForumTopicMessages`](https://core.telegram.org/bots/api#unpinallgeneralforumtopicmessages) | `Boolean` | Use this method to clear the list of pinned messages in a General forum topic. The bot must be an administrator in the chat for this to work and must have the can_pin_messages administrator right in the supergroup. Returns True on success. |
| [`unpinChatMessage`](https://core.telegram.org/bots/api#unpinchatmessage) | `Boolean` | Use this method to remove a message from the list of pinned messages in a chat. In private chats and channel direct messages chats, all messages can be unpinned. Conversely, the bot must be an administrator with the 'can_pin_messages' right or the 'can_edit_messages' right to unpin messages in groups and channels respectively. Returns True on success. |
| [`upgradeGift`](https://core.telegram.org/bots/api#upgradegift) | `Boolean` | Upgrades a given regular gift to a unique gift. Requires the can_transfer_and_upgrade_gifts business bot right. Additionally requires the can_transfer_stars business bot right if the upgrade is paid. Returns True on success. |
| [`uploadStickerFile`](https://core.telegram.org/bots/api#uploadstickerfile) | `File` | Use this method to upload a file with a sticker for later use in the createNewStickerSet, addStickerToSet, or replaceStickerInSet methods (the file can be used multiple times). Returns the uploaded File on success. |
| [`verifyChat`](https://core.telegram.org/bots/api#verifychat) | `Boolean` | Verifies a chat on behalf of the organization which is represented by the bot. Returns True on success. |
| [`verifyUser`](https://core.telegram.org/bots/api#verifyuser) | `Boolean` | Verifies a user on behalf of the organization which is represented by the bot. Returns True on success. |

## Referência completa — Tipos

| tipo | nº campos | descrição |
|---|---|---|
| [`AcceptedGiftTypes`](https://core.telegram.org/bots/api#acceptedgifttypes) | 5 | This object describes the types of gifts that can be gifted to a user or a chat. |
| [`AffiliateInfo`](https://core.telegram.org/bots/api#affiliateinfo) | 5 | Contains information about the affiliate that received a commission via this transaction. |
| [`Animation`](https://core.telegram.org/bots/api#animation) | 9 | This object represents an animation file (GIF or H.264/MPEG-4 AVC video without sound). |
| [`Audio`](https://core.telegram.org/bots/api#audio) | 9 | This object represents an audio file to be treated as music by the Telegram clients. |
| [`BackgroundFill`](https://core.telegram.org/bots/api#backgroundfill) | 0 | This object describes the way a background is filled based on the selected colors. Currently, it can be one of |
| [`BackgroundFillFreeformGradient`](https://core.telegram.org/bots/api#backgroundfillfreeformgradient) | 2 | The background is a freeform gradient that rotates after every message in the chat. |
| [`BackgroundFillGradient`](https://core.telegram.org/bots/api#backgroundfillgradient) | 4 | The background is a gradient fill. |
| [`BackgroundFillSolid`](https://core.telegram.org/bots/api#backgroundfillsolid) | 2 | The background is filled using the selected color. |
| [`BackgroundType`](https://core.telegram.org/bots/api#backgroundtype) | 0 | This object describes the type of a background. Currently, it can be one of |
| [`BackgroundTypeChatTheme`](https://core.telegram.org/bots/api#backgroundtypechattheme) | 2 | The background is taken directly from a built-in chat theme. |
| [`BackgroundTypeFill`](https://core.telegram.org/bots/api#backgroundtypefill) | 3 | The background is automatically filled based on the selected colors. |
| [`BackgroundTypePattern`](https://core.telegram.org/bots/api#backgroundtypepattern) | 6 | The background is a .PNG or .TGV (gzipped subset of SVG with MIME type "application/x-tgwallpattern") pattern to be combined with the background fill chosen by the user. |
| [`BackgroundTypeWallpaper`](https://core.telegram.org/bots/api#backgroundtypewallpaper) | 5 | The background is a wallpaper in the JPEG format. |
| [`Birthdate`](https://core.telegram.org/bots/api#birthdate) | 3 | Describes the birthdate of a user. |
| [`BotAccessSettings`](https://core.telegram.org/bots/api#botaccesssettings) | 2 | This object describes the access settings of a bot. |
| [`BotCommand`](https://core.telegram.org/bots/api#botcommand) | 2 | This object represents a bot command. |
| [`BotCommandScope`](https://core.telegram.org/bots/api#botcommandscope) | 0 | This object represents the scope to which bot commands are applied. Currently, the following 7 scopes are supported: |
| [`BotCommandScopeAllChatAdministrators`](https://core.telegram.org/bots/api#botcommandscopeallchatadministrators) | 1 | Represents the scope of bot commands, covering all group and supergroup chat administrators. |
| [`BotCommandScopeAllGroupChats`](https://core.telegram.org/bots/api#botcommandscopeallgroupchats) | 1 | Represents the scope of bot commands, covering all group and supergroup chats. |
| [`BotCommandScopeAllPrivateChats`](https://core.telegram.org/bots/api#botcommandscopeallprivatechats) | 1 | Represents the scope of bot commands, covering all private chats. |
| [`BotCommandScopeChat`](https://core.telegram.org/bots/api#botcommandscopechat) | 2 | Represents the scope of bot commands, covering a specific chat. |
| [`BotCommandScopeChatAdministrators`](https://core.telegram.org/bots/api#botcommandscopechatadministrators) | 2 | Represents the scope of bot commands, covering all administrators of a specific group or supergroup chat. |
| [`BotCommandScopeChatMember`](https://core.telegram.org/bots/api#botcommandscopechatmember) | 3 | Represents the scope of bot commands, covering a specific member of a group or supergroup chat. |
| [`BotCommandScopeDefault`](https://core.telegram.org/bots/api#botcommandscopedefault) | 1 | Represents the default scope of bot commands. Default commands are used if no commands with a narrower scope are specified for the user. |
| [`BotDescription`](https://core.telegram.org/bots/api#botdescription) | 1 | This object represents the bot's description. |
| [`BotName`](https://core.telegram.org/bots/api#botname) | 1 | This object represents the bot's name. |
| [`BotShortDescription`](https://core.telegram.org/bots/api#botshortdescription) | 1 | This object represents the bot's short description. |
| [`BusinessBotRights`](https://core.telegram.org/bots/api#businessbotrights) | 14 | Represents the rights of a business bot. |
| [`BusinessConnection`](https://core.telegram.org/bots/api#businessconnection) | 6 | Describes the connection of the bot with a business account. |
| [`BusinessIntro`](https://core.telegram.org/bots/api#businessintro) | 3 | Contains information about the start page settings of a Telegram Business account. |
| [`BusinessLocation`](https://core.telegram.org/bots/api#businesslocation) | 2 | Contains information about the location of a Telegram Business account. |
| [`BusinessMessagesDeleted`](https://core.telegram.org/bots/api#businessmessagesdeleted) | 3 | This object is received when messages are deleted from a connected business account. |
| [`BusinessOpeningHours`](https://core.telegram.org/bots/api#businessopeninghours) | 2 | Describes the opening hours of a business. |
| [`BusinessOpeningHoursInterval`](https://core.telegram.org/bots/api#businessopeninghoursinterval) | 2 | Describes an interval of time during which a business is open. |
| [`CallbackGame`](https://core.telegram.org/bots/api#callbackgame) | 0 | A placeholder, currently holds no information. Use BotFather to set up your game. |
| [`CallbackQuery`](https://core.telegram.org/bots/api#callbackquery) | 7 | This object represents an incoming callback query from a callback button in an inline keyboard. If the button that originated the query was attached to a message sent by the bot, the field message will be present. If the button was attached to a message sent via the bot (in inline mode), the field inline_message_id will be present. Exactly one of the fields data or game_short_name will be present. |
| [`Chat`](https://core.telegram.org/bots/api#chat) | 8 | This object represents a chat. |
| [`ChatAdministratorRights`](https://core.telegram.org/bots/api#chatadministratorrights) | 17 | Represents the rights of an administrator in a chat. |
| [`ChatBackground`](https://core.telegram.org/bots/api#chatbackground) | 1 | This object represents a chat background. |
| [`ChatBoost`](https://core.telegram.org/bots/api#chatboost) | 4 | This object contains information about a chat boost. |
| [`ChatBoostAdded`](https://core.telegram.org/bots/api#chatboostadded) | 1 | This object represents a service message about a user boosting a chat. |
| [`ChatBoostRemoved`](https://core.telegram.org/bots/api#chatboostremoved) | 4 | This object represents a boost removed from a chat. |
| [`ChatBoostSource`](https://core.telegram.org/bots/api#chatboostsource) | 0 | This object describes the source of a chat boost. It can be one of |
| [`ChatBoostSourceGiftCode`](https://core.telegram.org/bots/api#chatboostsourcegiftcode) | 2 | The boost was obtained by the creation of Telegram Premium gift codes to boost a chat. Each such code boosts the chat 4 times for the duration of the corresponding Telegram Premium subscription. |
| [`ChatBoostSourceGiveaway`](https://core.telegram.org/bots/api#chatboostsourcegiveaway) | 5 | The boost was obtained by the creation of a Telegram Premium or a Telegram Star giveaway. This boosts the chat 4 times for the duration of the corresponding Telegram Premium subscription for Telegram Premium giveaways and prize_star_count / 500 times for one year for Telegram Star giveaways. |
| [`ChatBoostSourcePremium`](https://core.telegram.org/bots/api#chatboostsourcepremium) | 2 | The boost was obtained by subscribing to Telegram Premium or by gifting a Telegram Premium subscription to another user. |
| [`ChatBoostUpdated`](https://core.telegram.org/bots/api#chatboostupdated) | 2 | This object represents a boost added to a chat or changed. |
| [`ChatFullInfo`](https://core.telegram.org/bots/api#chatfullinfo) | 51 | This object contains full information about a chat. |
| [`ChatInviteLink`](https://core.telegram.org/bots/api#chatinvitelink) | 11 | Represents an invite link for a chat. |
| [`ChatJoinRequest`](https://core.telegram.org/bots/api#chatjoinrequest) | 6 | Represents a join request sent to a chat. |
| [`ChatLocation`](https://core.telegram.org/bots/api#chatlocation) | 2 | Represents a location to which a chat is connected. |
| [`ChatMember`](https://core.telegram.org/bots/api#chatmember) | 0 | This object contains information about one member of a chat. Currently, the following 6 types of chat members are supported: |
| [`ChatMemberAdministrator`](https://core.telegram.org/bots/api#chatmemberadministrator) | 21 | Represents a chat member that has some additional privileges. |
| [`ChatMemberBanned`](https://core.telegram.org/bots/api#chatmemberbanned) | 3 | Represents a chat member that was banned in the chat and can't return to the chat or view chat messages. |
| [`ChatMemberLeft`](https://core.telegram.org/bots/api#chatmemberleft) | 2 | Represents a chat member that isn't currently a member of the chat, but may join it themselves. |
| [`ChatMemberMember`](https://core.telegram.org/bots/api#chatmembermember) | 4 | Represents a chat member that has no additional privileges or restrictions. |
| [`ChatMemberOwner`](https://core.telegram.org/bots/api#chatmemberowner) | 4 | Represents a chat member that owns the chat and has all administrator privileges. |
| [`ChatMemberRestricted`](https://core.telegram.org/bots/api#chatmemberrestricted) | 21 | Represents a chat member that is under certain restrictions in the chat. Supergroups only. |
| [`ChatMemberUpdated`](https://core.telegram.org/bots/api#chatmemberupdated) | 8 | This object represents changes in the status of a chat member. |
| [`ChatOwnerChanged`](https://core.telegram.org/bots/api#chatownerchanged) | 1 | Describes a service message about an ownership change in the chat. |
| [`ChatOwnerLeft`](https://core.telegram.org/bots/api#chatownerleft) | 1 | Describes a service message about the chat owner leaving the chat. |
| [`ChatPermissions`](https://core.telegram.org/bots/api#chatpermissions) | 16 | Describes actions that a non-administrator user is allowed to take in a chat. |
| [`ChatPhoto`](https://core.telegram.org/bots/api#chatphoto) | 4 | This object represents a chat photo. |
| [`ChatShared`](https://core.telegram.org/bots/api#chatshared) | 5 | This object contains information about a chat that was shared with the bot using a KeyboardButtonRequestChat button. |
| [`Checklist`](https://core.telegram.org/bots/api#checklist) | 5 | Describes a checklist. |
| [`ChecklistTask`](https://core.telegram.org/bots/api#checklisttask) | 6 | Describes a task in a checklist. |
| [`ChecklistTasksAdded`](https://core.telegram.org/bots/api#checklisttasksadded) | 2 | Describes a service message about tasks added to a checklist. |
| [`ChecklistTasksDone`](https://core.telegram.org/bots/api#checklisttasksdone) | 3 | Describes a service message about checklist tasks marked as done or not done. |
| [`ChosenInlineResult`](https://core.telegram.org/bots/api#choseninlineresult) | 5 | Represents a result of an inline query that was chosen by the user and sent to their chat partner. |
| [`Contact`](https://core.telegram.org/bots/api#contact) | 5 | This object represents a phone contact. |
| [`CopyTextButton`](https://core.telegram.org/bots/api#copytextbutton) | 1 | This object represents an inline keyboard button that copies specified text to the clipboard. |
| [`Dice`](https://core.telegram.org/bots/api#dice) | 2 | This object represents an animated emoji that displays a random value. |
| [`DirectMessagePriceChanged`](https://core.telegram.org/bots/api#directmessagepricechanged) | 2 | Describes a service message about a change in the price of direct messages sent to a channel chat. |
| [`DirectMessagesTopic`](https://core.telegram.org/bots/api#directmessagestopic) | 2 | Describes a topic of a direct messages chat. |
| [`Document`](https://core.telegram.org/bots/api#document) | 6 | This object represents a general file (as opposed to photos, voice messages and audio files). |
| [`EncryptedCredentials`](https://core.telegram.org/bots/api#encryptedcredentials) | 3 | Describes data required for decrypting and authenticating EncryptedPassportElement. See the Telegram Passport Documentation for a complete description of the data decryption and authentication processes. |
| [`EncryptedPassportElement`](https://core.telegram.org/bots/api#encryptedpassportelement) | 10 | Describes documents or other Telegram Passport elements shared with the bot by the user. |
| [`ExternalReplyInfo`](https://core.telegram.org/bots/api#externalreplyinfo) | 26 | This object contains information about a message that is being replied to, which may come from another chat or forum topic. |
| [`File`](https://core.telegram.org/bots/api#file) | 4 | This object represents a file ready to be downloaded. The file can be downloaded via the link https://api.telegram.org/file/bot<token>/<file_path>. It is guaranteed that the link will be valid for at least 1 hour. When the link expires, a new one can be requested by calling getFile. |
| [`ForceReply`](https://core.telegram.org/bots/api#forcereply) | 3 | Upon receiving a message with this object, Telegram clients will display a reply interface to the user (act as if the user has selected the bot's message and tapped 'Reply'). This can be extremely useful if you want to create user-friendly step-by-step interfaces without having to sacrifice privacy mode. Not supported in channels and for messages sent on behalf of a user account. |
| [`ForumTopic`](https://core.telegram.org/bots/api#forumtopic) | 5 | This object represents a forum topic. |
| [`ForumTopicClosed`](https://core.telegram.org/bots/api#forumtopicclosed) | 0 | This object represents a service message about a forum topic closed in the chat. Currently holds no information. |
| [`ForumTopicCreated`](https://core.telegram.org/bots/api#forumtopiccreated) | 4 | This object represents a service message about a new forum topic created in the chat. |
| [`ForumTopicEdited`](https://core.telegram.org/bots/api#forumtopicedited) | 2 | This object represents a service message about an edited forum topic. |
| [`ForumTopicReopened`](https://core.telegram.org/bots/api#forumtopicreopened) | 0 | This object represents a service message about a forum topic reopened in the chat. Currently holds no information. |
| [`Game`](https://core.telegram.org/bots/api#game) | 6 | This object represents a game. Use BotFather to create and edit games, their short names will act as unique identifiers. |
| [`GameHighScore`](https://core.telegram.org/bots/api#gamehighscore) | 3 | This object represents one row of the high scores table for a game. |
| [`GeneralForumTopicHidden`](https://core.telegram.org/bots/api#generalforumtopichidden) | 0 | This object represents a service message about General forum topic hidden in the chat. Currently holds no information. |
| [`GeneralForumTopicUnhidden`](https://core.telegram.org/bots/api#generalforumtopicunhidden) | 0 | This object represents a service message about General forum topic unhidden in the chat. Currently holds no information. |
| [`Gift`](https://core.telegram.org/bots/api#gift) | 13 | This object represents a gift that can be sent by the bot. |
| [`GiftBackground`](https://core.telegram.org/bots/api#giftbackground) | 3 | This object describes the background of a gift. |
| [`GiftInfo`](https://core.telegram.org/bots/api#giftinfo) | 10 | Describes a service message about a regular gift that was sent or received. |
| [`Gifts`](https://core.telegram.org/bots/api#gifts) | 1 | This object represent a list of gifts. |
| [`Giveaway`](https://core.telegram.org/bots/api#giveaway) | 9 | This object represents a message about a scheduled giveaway. |
| [`GiveawayCompleted`](https://core.telegram.org/bots/api#giveawaycompleted) | 4 | This object represents a service message about the completion of a giveaway without public winners. |
| [`GiveawayCreated`](https://core.telegram.org/bots/api#giveawaycreated) | 1 | This object represents a service message about the creation of a scheduled giveaway. |
| [`GiveawayWinners`](https://core.telegram.org/bots/api#giveawaywinners) | 12 | This object represents a message about the completion of a giveaway with public winners. |
| [`InaccessibleMessage`](https://core.telegram.org/bots/api#inaccessiblemessage) | 3 | This object describes a message that was deleted or is otherwise inaccessible to the bot. |
| [`InlineKeyboardButton`](https://core.telegram.org/bots/api#inlinekeyboardbutton) | 13 | This object represents one button of an inline keyboard. Exactly one of the fields other than text, icon_custom_emoji_id, and style must be used to specify the type of the button. |
| [`InlineKeyboardMarkup`](https://core.telegram.org/bots/api#inlinekeyboardmarkup) | 1 | This object represents an inline keyboard that appears right next to the message it belongs to. |
| [`InlineQuery`](https://core.telegram.org/bots/api#inlinequery) | 6 | This object represents an incoming inline query. When the user sends an empty query, your bot could return some default or trending results. |
| [`InlineQueryResult`](https://core.telegram.org/bots/api#inlinequeryresult) | 0 | This object represents one result of an inline query. Telegram clients currently support results of the following 20 types: |
| [`InlineQueryResultArticle`](https://core.telegram.org/bots/api#inlinequeryresultarticle) | 10 | Represents a link to an article or web page. |
| [`InlineQueryResultAudio`](https://core.telegram.org/bots/api#inlinequeryresultaudio) | 11 | Represents a link to an MP3 audio file. By default, this audio file will be sent by the user. Alternatively, you can use input_message_content to send a message with the specified content instead of the audio. |
| [`InlineQueryResultCachedAudio`](https://core.telegram.org/bots/api#inlinequeryresultcachedaudio) | 8 | Represents a link to an MP3 audio file stored on the Telegram servers. By default, this audio file will be sent by the user. Alternatively, you can use input_message_content to send a message with the specified content instead of the audio. |
| [`InlineQueryResultCachedDocument`](https://core.telegram.org/bots/api#inlinequeryresultcacheddocument) | 10 | Represents a link to a file stored on the Telegram servers. By default, this file will be sent by the user with an optional caption. Alternatively, you can use input_message_content to send a message with the specified content instead of the file. |
| [`InlineQueryResultCachedGif`](https://core.telegram.org/bots/api#inlinequeryresultcachedgif) | 10 | Represents a link to an animated GIF file stored on the Telegram servers. By default, this animated GIF file will be sent by the user with an optional caption. Alternatively, you can use input_message_content to send a message with specified content instead of the animation. |
| [`InlineQueryResultCachedMpeg4Gif`](https://core.telegram.org/bots/api#inlinequeryresultcachedmpeg4gif) | 10 | Represents a link to a video animation (H.264/MPEG-4 AVC video without sound) stored on the Telegram servers. By default, this animated MPEG-4 file will be sent by the user with an optional caption. Alternatively, you can use input_message_content to send a message with the specified content instead of the animation. |
| [`InlineQueryResultCachedPhoto`](https://core.telegram.org/bots/api#inlinequeryresultcachedphoto) | 11 | Represents a link to a photo stored on the Telegram servers. By default, this photo will be sent by the user with an optional caption. Alternatively, you can use input_message_content to send a message with the specified content instead of the photo. |
| [`InlineQueryResultCachedSticker`](https://core.telegram.org/bots/api#inlinequeryresultcachedsticker) | 5 | Represents a link to a sticker stored on the Telegram servers. By default, this sticker will be sent by the user. Alternatively, you can use input_message_content to send a message with the specified content instead of the sticker. |
| [`InlineQueryResultCachedVideo`](https://core.telegram.org/bots/api#inlinequeryresultcachedvideo) | 11 | Represents a link to a video file stored on the Telegram servers. By default, this video file will be sent by the user with an optional caption. Alternatively, you can use input_message_content to send a message with the specified content instead of the video. |
| [`InlineQueryResultCachedVoice`](https://core.telegram.org/bots/api#inlinequeryresultcachedvoice) | 9 | Represents a link to a voice message stored on the Telegram servers. By default, this voice message will be sent by the user. Alternatively, you can use input_message_content to send a message with the specified content instead of the voice message. |
| [`InlineQueryResultContact`](https://core.telegram.org/bots/api#inlinequeryresultcontact) | 11 | Represents a contact with a phone number. By default, this contact will be sent by the user. Alternatively, you can use input_message_content to send a message with the specified content instead of the contact. |
| [`InlineQueryResultDocument`](https://core.telegram.org/bots/api#inlinequeryresultdocument) | 14 | Represents a link to a file. By default, this file will be sent by the user with an optional caption. Alternatively, you can use input_message_content to send a message with the specified content instead of the file. Currently, only .PDF and .ZIP files can be sent using this method. |
| [`InlineQueryResultGame`](https://core.telegram.org/bots/api#inlinequeryresultgame) | 4 | Represents a Game. |
| [`InlineQueryResultGif`](https://core.telegram.org/bots/api#inlinequeryresultgif) | 15 | Represents a link to an animated GIF file. By default, this animated GIF file will be sent by the user with optional caption. Alternatively, you can use input_message_content to send a message with the specified content instead of the animation. |
| [`InlineQueryResultLocation`](https://core.telegram.org/bots/api#inlinequeryresultlocation) | 14 | Represents a location on a map. By default, the location will be sent by the user. Alternatively, you can use input_message_content to send a message with the specified content instead of the location. |
| [`InlineQueryResultMpeg4Gif`](https://core.telegram.org/bots/api#inlinequeryresultmpeg4gif) | 15 | Represents a link to a video animation (H.264/MPEG-4 AVC video without sound). By default, this animated MPEG-4 file will be sent by the user with optional caption. Alternatively, you can use input_message_content to send a message with the specified content instead of the animation. |
| [`InlineQueryResultPhoto`](https://core.telegram.org/bots/api#inlinequeryresultphoto) | 14 | Represents a link to a photo. By default, this photo will be sent by the user with optional caption. Alternatively, you can use input_message_content to send a message with the specified content instead of the photo. |
| [`InlineQueryResultVenue`](https://core.telegram.org/bots/api#inlinequeryresultvenue) | 15 | Represents a venue. By default, the venue will be sent by the user. Alternatively, you can use input_message_content to send a message with the specified content instead of the venue. |
| [`InlineQueryResultVideo`](https://core.telegram.org/bots/api#inlinequeryresultvideo) | 16 | Represents a link to a page containing an embedded video player or a video file. By default, this video file will be sent by the user with an optional caption. Alternatively, you can use input_message_content to send a message with the specified content instead of the video. |
| [`InlineQueryResultVoice`](https://core.telegram.org/bots/api#inlinequeryresultvoice) | 10 | Represents a link to a voice recording in an .OGG container encoded with OPUS. By default, this voice recording will be sent by the user. Alternatively, you can use input_message_content to send a message with the specified content instead of the the voice message. |
| [`InlineQueryResultsButton`](https://core.telegram.org/bots/api#inlinequeryresultsbutton) | 3 | This object represents a button to be shown above inline query results. You must use exactly one of the optional fields. |
| [`InputChecklist`](https://core.telegram.org/bots/api#inputchecklist) | 6 | Describes a checklist to create. |
| [`InputChecklistTask`](https://core.telegram.org/bots/api#inputchecklisttask) | 4 | Describes a task to add to a checklist. |
| [`InputContactMessageContent`](https://core.telegram.org/bots/api#inputcontactmessagecontent) | 4 | Represents the content of a contact message to be sent as the result of an inline query. |
| [`InputFile`](https://core.telegram.org/bots/api#inputfile) | 0 | This object represents the contents of a file to be uploaded. Must be posted using multipart/form-data in the usual way that files are uploaded via the browser. |
| [`InputInvoiceMessageContent`](https://core.telegram.org/bots/api#inputinvoicemessagecontent) | 20 | Represents the content of an invoice message to be sent as the result of an inline query. |
| [`InputLocationMessageContent`](https://core.telegram.org/bots/api#inputlocationmessagecontent) | 6 | Represents the content of a location message to be sent as the result of an inline query. |
| [`InputMedia`](https://core.telegram.org/bots/api#inputmedia) | 0 | This object represents the content of a media message to be sent. It should be one of |
| [`InputMediaAnimation`](https://core.telegram.org/bots/api#inputmediaanimation) | 11 | Represents an animation file (GIF or H.264/MPEG-4 AVC video without sound) to be sent. |
| [`InputMediaAudio`](https://core.telegram.org/bots/api#inputmediaaudio) | 9 | Represents an audio file to be treated as music to be sent. |
| [`InputMediaDocument`](https://core.telegram.org/bots/api#inputmediadocument) | 7 | Represents a general file to be sent. |
| [`InputMediaLivePhoto`](https://core.telegram.org/bots/api#inputmedialivephoto) | 8 | Represents a live photo to be sent. |
| [`InputMediaLocation`](https://core.telegram.org/bots/api#inputmedialocation) | 4 | Represents a location to be sent. |
| [`InputMediaPhoto`](https://core.telegram.org/bots/api#inputmediaphoto) | 7 | Represents a photo to be sent. |
| [`InputMediaSticker`](https://core.telegram.org/bots/api#inputmediasticker) | 3 | Represents a sticker file to be sent. |
| [`InputMediaVenue`](https://core.telegram.org/bots/api#inputmediavenue) | 9 | Represents a venue to be sent. |
| [`InputMediaVideo`](https://core.telegram.org/bots/api#inputmediavideo) | 14 | Represents a video to be sent. |
| [`InputMessageContent`](https://core.telegram.org/bots/api#inputmessagecontent) | 0 | This object represents the content of a message to be sent as a result of an inline query. Telegram clients currently support the following 5 types: |
| [`InputPaidMedia`](https://core.telegram.org/bots/api#inputpaidmedia) | 0 | This object describes the paid media to be sent. Currently, it can be one of |
| [`InputPaidMediaLivePhoto`](https://core.telegram.org/bots/api#inputpaidmedialivephoto) | 3 | The paid media to send is a live photo. |
| [`InputPaidMediaPhoto`](https://core.telegram.org/bots/api#inputpaidmediaphoto) | 2 | The paid media to send is a photo. |
| [`InputPaidMediaVideo`](https://core.telegram.org/bots/api#inputpaidmediavideo) | 9 | The paid media to send is a video. |
| [`InputPollMedia`](https://core.telegram.org/bots/api#inputpollmedia) | 0 | This object represents the content of a poll description or a quiz explanation to be sent. It should be one of |
| [`InputPollOption`](https://core.telegram.org/bots/api#inputpolloption) | 4 | This object contains information about one answer option in a poll to be sent. |
| [`InputPollOptionMedia`](https://core.telegram.org/bots/api#inputpolloptionmedia) | 0 | This object represents the content of a poll option to be sent. It should be one of |
| [`InputProfilePhoto`](https://core.telegram.org/bots/api#inputprofilephoto) | 0 | This object describes a profile photo to set. Currently, it can be one of |
| [`InputProfilePhotoAnimated`](https://core.telegram.org/bots/api#inputprofilephotoanimated) | 3 | An animated profile photo in the MPEG4 format. |
| [`InputProfilePhotoStatic`](https://core.telegram.org/bots/api#inputprofilephotostatic) | 2 | A static profile photo in the .JPG format. |
| [`InputSticker`](https://core.telegram.org/bots/api#inputsticker) | 5 | This object describes a sticker to be added to a sticker set. |
| [`InputStoryContent`](https://core.telegram.org/bots/api#inputstorycontent) | 0 | This object describes the content of a story to post. Currently, it can be one of |
| [`InputStoryContentPhoto`](https://core.telegram.org/bots/api#inputstorycontentphoto) | 2 | Describes a photo to post as a story. |
| [`InputStoryContentVideo`](https://core.telegram.org/bots/api#inputstorycontentvideo) | 5 | Describes a video to post as a story. |
| [`InputTextMessageContent`](https://core.telegram.org/bots/api#inputtextmessagecontent) | 4 | Represents the content of a text message to be sent as the result of an inline query. |
| [`InputVenueMessageContent`](https://core.telegram.org/bots/api#inputvenuemessagecontent) | 8 | Represents the content of a venue message to be sent as the result of an inline query. |
| [`Invoice`](https://core.telegram.org/bots/api#invoice) | 5 | This object contains basic information about an invoice. |
| [`KeyboardButton`](https://core.telegram.org/bots/api#keyboardbutton) | 10 | This object represents one button of the reply keyboard. At most one of the fields other than text, icon_custom_emoji_id, and style must be used to specify the type of the button. For simple text buttons, String can be used instead of this object to specify the button text. |
| [`KeyboardButtonPollType`](https://core.telegram.org/bots/api#keyboardbuttonpolltype) | 1 | This object represents type of a poll, which is allowed to be created and sent when the corresponding button is pressed. |
| [`KeyboardButtonRequestChat`](https://core.telegram.org/bots/api#keyboardbuttonrequestchat) | 11 | This object defines the criteria used to request a suitable chat. Information about the selected chat will be shared with the bot when the corresponding button is pressed. The bot will be granted requested rights in the chat if appropriate. More about requesting chats: https://core.telegram.org/bots/features#chat-and-user-selection. |
| [`KeyboardButtonRequestManagedBot`](https://core.telegram.org/bots/api#keyboardbuttonrequestmanagedbot) | 3 | This object defines the parameters for the creation of a managed bot. Information about the created bot will be shared with the bot using the update managed_bot and a Message with the field managed_bot_created. |
| [`KeyboardButtonRequestUsers`](https://core.telegram.org/bots/api#keyboardbuttonrequestusers) | 7 | This object defines the criteria used to request suitable users. Information about the selected users will be shared with the bot when the corresponding button is pressed. More about requesting users: https://core.telegram.org/bots/features#chat-and-user-selection |
| [`LabeledPrice`](https://core.telegram.org/bots/api#labeledprice) | 2 | This object represents a portion of the price for goods or services. |
| [`LinkPreviewOptions`](https://core.telegram.org/bots/api#linkpreviewoptions) | 5 | Describes the options used for link preview generation. |
| [`LivePhoto`](https://core.telegram.org/bots/api#livephoto) | 8 | This object represents a live photo. |
| [`Location`](https://core.telegram.org/bots/api#location) | 6 | This object represents a point on the map. |
| [`LocationAddress`](https://core.telegram.org/bots/api#locationaddress) | 4 | Describes the physical address of a location. |
| [`LoginUrl`](https://core.telegram.org/bots/api#loginurl) | 4 | This object represents a parameter of the inline keyboard button used to automatically authorize a user. Serves as a great replacement for the Telegram Login Widget when the user is coming from Telegram. All the user needs to do is tap/click a button and confirm that they want to log in: |
| [`ManagedBotCreated`](https://core.telegram.org/bots/api#managedbotcreated) | 1 | This object contains information about the bot that was created to be managed by the current bot. |
| [`ManagedBotUpdated`](https://core.telegram.org/bots/api#managedbotupdated) | 2 | This object contains information about the creation, token update, or owner update of a bot that is managed by the current bot. |
| [`MaskPosition`](https://core.telegram.org/bots/api#maskposition) | 4 | This object describes the position on faces where a mask should be placed by default. |
| [`MaybeInaccessibleMessage`](https://core.telegram.org/bots/api#maybeinaccessiblemessage) | 0 | This object describes a message that can be inaccessible to the bot. It can be one of |
| [`MenuButton`](https://core.telegram.org/bots/api#menubutton) | 0 | This object describes the bot's menu button in a private chat. It should be one of |
| [`MenuButtonCommands`](https://core.telegram.org/bots/api#menubuttoncommands) | 1 | Represents a menu button, which opens the bot's list of commands. |
| [`MenuButtonDefault`](https://core.telegram.org/bots/api#menubuttondefault) | 1 | Describes that no specific value for the menu button was set. |
| [`MenuButtonWebApp`](https://core.telegram.org/bots/api#menubuttonwebapp) | 3 | Represents a menu button, which launches a Web App. |
| [`Message`](https://core.telegram.org/bots/api#message) | 114 | This object represents a message. |
| [`MessageAutoDeleteTimerChanged`](https://core.telegram.org/bots/api#messageautodeletetimerchanged) | 1 | This object represents a service message about a change in auto-delete timer settings. |
| [`MessageEntity`](https://core.telegram.org/bots/api#messageentity) | 9 | This object represents one special entity in a text message. For example, hashtags, usernames, URLs, etc. |
| [`MessageId`](https://core.telegram.org/bots/api#messageid) | 1 | This object represents a unique message identifier. |
| [`MessageOrigin`](https://core.telegram.org/bots/api#messageorigin) | 0 | This object describes the origin of a message. It can be one of |
| [`MessageOriginChannel`](https://core.telegram.org/bots/api#messageoriginchannel) | 5 | The message was originally sent to a channel chat. |
| [`MessageOriginChat`](https://core.telegram.org/bots/api#messageoriginchat) | 4 | The message was originally sent on behalf of a chat to a group chat. |
| [`MessageOriginHiddenUser`](https://core.telegram.org/bots/api#messageoriginhiddenuser) | 3 | The message was originally sent by an unknown user. |
| [`MessageOriginUser`](https://core.telegram.org/bots/api#messageoriginuser) | 3 | The message was originally sent by a known user. |
| [`MessageReactionCountUpdated`](https://core.telegram.org/bots/api#messagereactioncountupdated) | 4 | This object represents reaction changes on a message with anonymous reactions. |
| [`MessageReactionUpdated`](https://core.telegram.org/bots/api#messagereactionupdated) | 7 | This object represents a change of a reaction on a message performed by a user. |
| [`OrderInfo`](https://core.telegram.org/bots/api#orderinfo) | 4 | This object represents information about an order. |
| [`OwnedGift`](https://core.telegram.org/bots/api#ownedgift) | 0 | This object describes a gift received and owned by a user or a chat. Currently, it can be one of |
| [`OwnedGiftRegular`](https://core.telegram.org/bots/api#ownedgiftregular) | 15 | Describes a regular gift owned by a user or a chat. |
| [`OwnedGiftUnique`](https://core.telegram.org/bots/api#ownedgiftunique) | 9 | Describes a unique gift received and owned by a user or a chat. |
| [`OwnedGifts`](https://core.telegram.org/bots/api#ownedgifts) | 3 | Contains the list of gifts received and owned by a user or a chat. |
| [`PaidMedia`](https://core.telegram.org/bots/api#paidmedia) | 0 | This object describes paid media. Currently, it can be one of |
| [`PaidMediaInfo`](https://core.telegram.org/bots/api#paidmediainfo) | 2 | Describes the paid media added to a message. |
| [`PaidMediaLivePhoto`](https://core.telegram.org/bots/api#paidmedialivephoto) | 2 | The paid media is a live photo. |
| [`PaidMediaPhoto`](https://core.telegram.org/bots/api#paidmediaphoto) | 2 | The paid media is a photo. |
| [`PaidMediaPreview`](https://core.telegram.org/bots/api#paidmediapreview) | 4 | The paid media isn't available before the payment. |
| [`PaidMediaPurchased`](https://core.telegram.org/bots/api#paidmediapurchased) | 2 | This object contains information about a paid media purchase. |
| [`PaidMediaVideo`](https://core.telegram.org/bots/api#paidmediavideo) | 2 | The paid media is a video. |
| [`PaidMessagePriceChanged`](https://core.telegram.org/bots/api#paidmessagepricechanged) | 1 | Describes a service message about a change in the price of paid messages within a chat. |
| [`PassportData`](https://core.telegram.org/bots/api#passportdata) | 2 | Describes Telegram Passport data shared with the bot by the user. |
| [`PassportElementError`](https://core.telegram.org/bots/api#passportelementerror) | 0 | This object represents an error in the Telegram Passport element which was submitted that should be resolved by the user. It should be one of: |
| [`PassportElementErrorDataField`](https://core.telegram.org/bots/api#passportelementerrordatafield) | 5 | Represents an issue in one of the data fields that was provided by the user. The error is considered resolved when the field's value changes. |
| [`PassportElementErrorFile`](https://core.telegram.org/bots/api#passportelementerrorfile) | 4 | Represents an issue with a document scan. The error is considered resolved when the file with the document scan changes. |
| [`PassportElementErrorFiles`](https://core.telegram.org/bots/api#passportelementerrorfiles) | 4 | Represents an issue with a list of scans. The error is considered resolved when the list of files containing the scans changes. |
| [`PassportElementErrorFrontSide`](https://core.telegram.org/bots/api#passportelementerrorfrontside) | 4 | Represents an issue with the front side of a document. The error is considered resolved when the file with the front side of the document changes. |
| [`PassportElementErrorReverseSide`](https://core.telegram.org/bots/api#passportelementerrorreverseside) | 4 | Represents an issue with the reverse side of a document. The error is considered resolved when the file with reverse side of the document changes. |
| [`PassportElementErrorSelfie`](https://core.telegram.org/bots/api#passportelementerrorselfie) | 4 | Represents an issue with the selfie with a document. The error is considered resolved when the file with the selfie changes. |
| [`PassportElementErrorTranslationFile`](https://core.telegram.org/bots/api#passportelementerrortranslationfile) | 4 | Represents an issue with one of the files that constitute the translation of a document. The error is considered resolved when the file changes. |
| [`PassportElementErrorTranslationFiles`](https://core.telegram.org/bots/api#passportelementerrortranslationfiles) | 4 | Represents an issue with the translated version of a document. The error is considered resolved when a file with the document translation change. |
| [`PassportElementErrorUnspecified`](https://core.telegram.org/bots/api#passportelementerrorunspecified) | 4 | Represents an issue in an unspecified place. The error is considered resolved when new data is added. |
| [`PassportFile`](https://core.telegram.org/bots/api#passportfile) | 4 | This object represents a file uploaded to Telegram Passport. Currently all Telegram Passport files are in JPEG format when decrypted and don't exceed 10MB. |
| [`PhotoSize`](https://core.telegram.org/bots/api#photosize) | 5 | This object represents one size of a photo or a file / sticker thumbnail. |
| [`Poll`](https://core.telegram.org/bots/api#poll) | 21 | This object contains information about a poll. |
| [`PollAnswer`](https://core.telegram.org/bots/api#pollanswer) | 5 | This object represents an answer of a user in a non-anonymous poll. |
| [`PollMedia`](https://core.telegram.org/bots/api#pollmedia) | 9 | At most one of the optional fields can be present in any given object. |
| [`PollOption`](https://core.telegram.org/bots/api#polloption) | 8 | This object contains information about one answer option in a poll. |
| [`PollOptionAdded`](https://core.telegram.org/bots/api#polloptionadded) | 4 | Describes a service message about an option added to a poll. |
| [`PollOptionDeleted`](https://core.telegram.org/bots/api#polloptiondeleted) | 4 | Describes a service message about an option deleted from a poll. |
| [`PreCheckoutQuery`](https://core.telegram.org/bots/api#precheckoutquery) | 7 | This object contains information about an incoming pre-checkout query. |
| [`PreparedInlineMessage`](https://core.telegram.org/bots/api#preparedinlinemessage) | 2 | Describes an inline message to be sent by a user of a Mini App. |
| [`PreparedKeyboardButton`](https://core.telegram.org/bots/api#preparedkeyboardbutton) | 1 | Describes a keyboard button to be used by a user of a Mini App. |
| [`ProximityAlertTriggered`](https://core.telegram.org/bots/api#proximityalerttriggered) | 3 | This object represents the content of a service message, sent whenever a user in the chat triggers a proximity alert set by another user. |
| [`ReactionCount`](https://core.telegram.org/bots/api#reactioncount) | 2 | Represents a reaction added to a message along with the number of times it was added. |
| [`ReactionType`](https://core.telegram.org/bots/api#reactiontype) | 0 | This object describes the type of a reaction. Currently, it can be one of |
| [`ReactionTypeCustomEmoji`](https://core.telegram.org/bots/api#reactiontypecustomemoji) | 2 | The reaction is based on a custom emoji. |
| [`ReactionTypeEmoji`](https://core.telegram.org/bots/api#reactiontypeemoji) | 2 | The reaction is based on an emoji. |
| [`ReactionTypePaid`](https://core.telegram.org/bots/api#reactiontypepaid) | 1 | The reaction is paid. |
| [`RefundedPayment`](https://core.telegram.org/bots/api#refundedpayment) | 5 | This object contains basic information about a refunded payment. |
| [`ReplyKeyboardMarkup`](https://core.telegram.org/bots/api#replykeyboardmarkup) | 6 | This object represents a custom keyboard with reply options (see Introduction to bots for details and examples). Not supported in channels and for messages sent on behalf of a business account. |
| [`ReplyKeyboardRemove`](https://core.telegram.org/bots/api#replykeyboardremove) | 2 | Upon receiving a message with this object, Telegram clients will remove the current custom keyboard and display the default letter-keyboard. By default, custom keyboards are displayed until a new keyboard is sent by a bot. An exception is made for one-time keyboards that are hidden immediately after the user presses a button (see ReplyKeyboardMarkup). Not supported in channels and for messages sent on behalf of a business account. |
| [`ReplyParameters`](https://core.telegram.org/bots/api#replyparameters) | 9 | Describes reply parameters for the message that is being sent. |
| [`ResponseParameters`](https://core.telegram.org/bots/api#responseparameters) | 2 | Describes why a request was unsuccessful. |
| [`RevenueWithdrawalState`](https://core.telegram.org/bots/api#revenuewithdrawalstate) | 0 | This object describes the state of a revenue withdrawal operation. Currently, it can be one of |
| [`RevenueWithdrawalStateFailed`](https://core.telegram.org/bots/api#revenuewithdrawalstatefailed) | 1 | The withdrawal failed and the transaction was refunded. |
| [`RevenueWithdrawalStatePending`](https://core.telegram.org/bots/api#revenuewithdrawalstatepending) | 1 | The withdrawal is in progress. |
| [`RevenueWithdrawalStateSucceeded`](https://core.telegram.org/bots/api#revenuewithdrawalstatesucceeded) | 3 | The withdrawal succeeded. |
| [`SentGuestMessage`](https://core.telegram.org/bots/api#sentguestmessage) | 1 | Describes an inline message sent by a guest bot. |
| [`SentWebAppMessage`](https://core.telegram.org/bots/api#sentwebappmessage) | 1 | Describes an inline message sent by a Web App on behalf of a user. |
| [`SharedUser`](https://core.telegram.org/bots/api#shareduser) | 5 | This object contains information about a user that was shared with the bot using a KeyboardButtonRequestUsers button. |
| [`ShippingAddress`](https://core.telegram.org/bots/api#shippingaddress) | 6 | This object represents a shipping address. |
| [`ShippingOption`](https://core.telegram.org/bots/api#shippingoption) | 3 | This object represents one shipping option. |
| [`ShippingQuery`](https://core.telegram.org/bots/api#shippingquery) | 4 | This object contains information about an incoming shipping query. |
| [`StarAmount`](https://core.telegram.org/bots/api#staramount) | 2 | Describes an amount of Telegram Stars. |
| [`StarTransaction`](https://core.telegram.org/bots/api#startransaction) | 6 | Describes a Telegram Star transaction. Note that if the buyer initiates a chargeback with the payment provider from whom they acquired Stars (e.g., Apple, Google) following this transaction, the refunded Stars will be deducted from the bot's balance. This is outside of Telegram's control. |
| [`StarTransactions`](https://core.telegram.org/bots/api#startransactions) | 1 | Contains a list of Telegram Star transactions. |
| [`Sticker`](https://core.telegram.org/bots/api#sticker) | 15 | This object represents a sticker. |
| [`StickerSet`](https://core.telegram.org/bots/api#stickerset) | 5 | This object represents a sticker set. |
| [`Story`](https://core.telegram.org/bots/api#story) | 2 | This object represents a story. |
| [`StoryArea`](https://core.telegram.org/bots/api#storyarea) | 2 | Describes a clickable area on a story media. |
| [`StoryAreaPosition`](https://core.telegram.org/bots/api#storyareaposition) | 6 | Describes the position of a clickable area within a story. |
| [`StoryAreaType`](https://core.telegram.org/bots/api#storyareatype) | 0 | Describes the type of a clickable area on a story. Currently, it can be one of |
| [`StoryAreaTypeLink`](https://core.telegram.org/bots/api#storyareatypelink) | 2 | Describes a story area pointing to an HTTP or tg:// link. Currently, a story can have up to 3 link areas. |
| [`StoryAreaTypeLocation`](https://core.telegram.org/bots/api#storyareatypelocation) | 4 | Describes a story area pointing to a location. Currently, a story can have up to 10 location areas. |
| [`StoryAreaTypeSuggestedReaction`](https://core.telegram.org/bots/api#storyareatypesuggestedreaction) | 4 | Describes a story area pointing to a suggested reaction. Currently, a story can have up to 5 suggested reaction areas. |
| [`StoryAreaTypeUniqueGift`](https://core.telegram.org/bots/api#storyareatypeuniquegift) | 2 | Describes a story area pointing to a unique gift. Currently, a story can have at most 1 unique gift area. |
| [`StoryAreaTypeWeather`](https://core.telegram.org/bots/api#storyareatypeweather) | 4 | Describes a story area containing weather information. Currently, a story can have up to 3 weather areas. |
| [`SuccessfulPayment`](https://core.telegram.org/bots/api#successfulpayment) | 10 | This object contains basic information about a successful payment. Note that if the buyer initiates a chargeback with the relevant payment provider following this transaction, the funds may be debited from your balance. This is outside of Telegram's control. |
| [`SuggestedPostApprovalFailed`](https://core.telegram.org/bots/api#suggestedpostapprovalfailed) | 2 | Describes a service message about the failed approval of a suggested post. Currently, only caused by insufficient user funds at the time of approval. |
| [`SuggestedPostApproved`](https://core.telegram.org/bots/api#suggestedpostapproved) | 3 | Describes a service message about the approval of a suggested post. |
| [`SuggestedPostDeclined`](https://core.telegram.org/bots/api#suggestedpostdeclined) | 2 | Describes a service message about the rejection of a suggested post. |
| [`SuggestedPostInfo`](https://core.telegram.org/bots/api#suggestedpostinfo) | 3 | Contains information about a suggested post. |
| [`SuggestedPostPaid`](https://core.telegram.org/bots/api#suggestedpostpaid) | 4 | Describes a service message about a successful payment for a suggested post. |
| [`SuggestedPostParameters`](https://core.telegram.org/bots/api#suggestedpostparameters) | 2 | Contains parameters of a post that is being suggested by the bot. |
| [`SuggestedPostPrice`](https://core.telegram.org/bots/api#suggestedpostprice) | 2 | Describes the price of a suggested post. |
| [`SuggestedPostRefunded`](https://core.telegram.org/bots/api#suggestedpostrefunded) | 2 | Describes a service message about a payment refund for a suggested post. |
| [`SwitchInlineQueryChosenChat`](https://core.telegram.org/bots/api#switchinlinequerychosenchat) | 5 | This object represents an inline button that switches the current user to inline mode in a chosen chat, with an optional default inline query. |
| [`TextQuote`](https://core.telegram.org/bots/api#textquote) | 4 | This object contains information about the quoted part of a message that is replied to by the given message. |
| [`TransactionPartner`](https://core.telegram.org/bots/api#transactionpartner) | 0 | This object describes the source of a transaction, or its recipient for outgoing transactions. Currently, it can be one of |
| [`TransactionPartnerAffiliateProgram`](https://core.telegram.org/bots/api#transactionpartneraffiliateprogram) | 3 | Describes the affiliate program that issued the affiliate commission received via this transaction. |
| [`TransactionPartnerChat`](https://core.telegram.org/bots/api#transactionpartnerchat) | 3 | Describes a transaction with a chat. |
| [`TransactionPartnerFragment`](https://core.telegram.org/bots/api#transactionpartnerfragment) | 2 | Describes a withdrawal transaction with Fragment. |
| [`TransactionPartnerOther`](https://core.telegram.org/bots/api#transactionpartnerother) | 1 | Describes a transaction with an unknown source or recipient. |
| [`TransactionPartnerTelegramAds`](https://core.telegram.org/bots/api#transactionpartnertelegramads) | 1 | Describes a withdrawal transaction to the Telegram Ads platform. |
| [`TransactionPartnerTelegramApi`](https://core.telegram.org/bots/api#transactionpartnertelegramapi) | 2 | Describes a transaction with payment for paid broadcasting. |
| [`TransactionPartnerUser`](https://core.telegram.org/bots/api#transactionpartneruser) | 10 | Describes a transaction with a user. |
| [`UniqueGift`](https://core.telegram.org/bots/api#uniquegift) | 12 | This object describes a unique gift that was upgraded from a regular gift. |
| [`UniqueGiftBackdrop`](https://core.telegram.org/bots/api#uniquegiftbackdrop) | 3 | This object describes the backdrop of a unique gift. |
| [`UniqueGiftBackdropColors`](https://core.telegram.org/bots/api#uniquegiftbackdropcolors) | 4 | This object describes the colors of the backdrop of a unique gift. |
| [`UniqueGiftColors`](https://core.telegram.org/bots/api#uniquegiftcolors) | 6 | This object contains information about the color scheme for a user's name, message replies and link previews based on a unique gift. |
| [`UniqueGiftInfo`](https://core.telegram.org/bots/api#uniquegiftinfo) | 7 | Describes a service message about a unique gift that was sent or received. |
| [`UniqueGiftModel`](https://core.telegram.org/bots/api#uniquegiftmodel) | 4 | This object describes the model of a unique gift. |
| [`UniqueGiftSymbol`](https://core.telegram.org/bots/api#uniquegiftsymbol) | 3 | This object describes the symbol shown on the pattern of a unique gift. |
| [`Update`](https://core.telegram.org/bots/api#update) | 26 | This object represents an incoming update. |
| [`User`](https://core.telegram.org/bots/api#user) | 17 | This object represents a Telegram user or bot. |
| [`UserChatBoosts`](https://core.telegram.org/bots/api#userchatboosts) | 1 | This object represents a list of boosts added to a chat by a user. |
| [`UserProfileAudios`](https://core.telegram.org/bots/api#userprofileaudios) | 2 | This object represents the audios displayed on a user's profile. |
| [`UserProfilePhotos`](https://core.telegram.org/bots/api#userprofilephotos) | 2 | This object represent a user's profile pictures. |
| [`UserRating`](https://core.telegram.org/bots/api#userrating) | 4 | This object describes the rating of a user based on their Telegram Star spendings. |
| [`UsersShared`](https://core.telegram.org/bots/api#usersshared) | 2 | This object contains information about the users whose identifiers were shared with the bot using a KeyboardButtonRequestUsers button. |
| [`Venue`](https://core.telegram.org/bots/api#venue) | 7 | This object represents a venue. |
| [`Video`](https://core.telegram.org/bots/api#video) | 12 | This object represents a video file. |
| [`VideoChatEnded`](https://core.telegram.org/bots/api#videochatended) | 1 | This object represents a service message about a video chat ended in the chat. |
| [`VideoChatParticipantsInvited`](https://core.telegram.org/bots/api#videochatparticipantsinvited) | 1 | This object represents a service message about new members invited to a video chat. |
| [`VideoChatScheduled`](https://core.telegram.org/bots/api#videochatscheduled) | 1 | This object represents a service message about a video chat scheduled in the chat. |
| [`VideoChatStarted`](https://core.telegram.org/bots/api#videochatstarted) | 0 | This object represents a service message about a video chat started in the chat. Currently holds no information. |
| [`VideoNote`](https://core.telegram.org/bots/api#videonote) | 6 | This object represents a video message (available in Telegram apps as of v.4.0). |
| [`VideoQuality`](https://core.telegram.org/bots/api#videoquality) | 6 | This object represents a video file of a specific quality. |
| [`Voice`](https://core.telegram.org/bots/api#voice) | 5 | This object represents a voice note. |
| [`WebAppData`](https://core.telegram.org/bots/api#webappdata) | 2 | Describes data sent from a Web App to the bot. |
| [`WebAppInfo`](https://core.telegram.org/bots/api#webappinfo) | 1 | Describes a Web App. |
| [`WebhookInfo`](https://core.telegram.org/bots/api#webhookinfo) | 9 | Describes the current status of a webhook. |
| [`WriteAccessAllowed`](https://core.telegram.org/bots/api#writeaccessallowed) | 3 | This object represents a service message about a user allowing a bot to write messages after adding it to the attachment menu, launching a Web App from a link, or accepting an explicit request from a Web App sent by the method requestWriteAccess. |
