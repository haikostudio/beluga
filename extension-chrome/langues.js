/**
 * LES TEXTES DU PANNEAU, DANS LES CINQ LANGUES DE BELUGA. La clé est le texte français ; les quatre traductions
 * suivent l'ordre de l'application : anglais, espagnol, allemand, chinois. La langue est celle choisie dans
 * Beluga (envoyée par le démon à la connexion).
 */
const TEXTES = {
  'Ce que l’agent a vu': ['What the agent saw', 'Lo que vio el agente', 'Was der Agent gesehen hat', '智能体看到的内容'],
  Fermer: ['Close', 'Cerrar', 'Schließen', '关闭'],
  Retirer: ['Remove', 'Quitar', 'Entfernen', '移除'],
  Fichier: ['File', 'Archivo', 'Datei', '文件'],
  '{n} fichiers au plus par message.': ['{n} files at most per message.', '{n} archivos como máximo por mensaje.', 'Höchstens {n} Dateien pro Nachricht.', '每条消息最多 {n} 个文件。'],
  '« {nom} » est trop lourd : 15 Mo au plus par message.': ['“{nom}” is too large: 15 MB at most per message.', '«{nom}» es demasiado pesado: 15 MB como máximo por mensaje.', '„{nom}“ ist zu groß: höchstens 15 MB pro Nachricht.', '“{nom}”太大：每条消息最多 15 MB。'],
  '« {nom} » n’a pas pu être lu.': ['“{nom}” could not be read.', 'No se pudo leer «{nom}».', '„{nom}“ konnte nicht gelesen werden.', '无法读取“{nom}”。'],
  '1 message en attente': ['1 queued message', '1 mensaje en espera', '1 wartende Nachricht', '1 条待发送消息'],
  '{n} messages en attente': ['{n} queued messages', '{n} mensajes en espera', '{n} wartende Nachrichten', '{n} 条待发送消息'],
  Modifier: ['Edit', 'Editar', 'Bearbeiten', '编辑'],
  'Envoyer maintenant': ['Send now', 'Enviar ahora', 'Jetzt senden', '立即发送'],
  'Retirer de la file': ['Remove from queue', 'Quitar de la cola', 'Aus der Warteschlange entfernen', '从队列中移除'],
  Enregistrer: ['Save', 'Guardar', 'Speichern', '保存'],
  'Nouvelle demande sur cette page…': ['New request on this page…', 'Nueva solicitud en esta página…', 'Neue Anfrage auf dieser Seite…', '在此页面上的新请求…'],
  'Votre message attendra la fin du travail…': ['Your message will wait until the work is done…', 'Su mensaje esperará a que termine el trabajo…', 'Ihre Nachricht wartet, bis die Arbeit fertig ist…', '您的消息将在工作完成后发送…'],
  'Travail terminé : nouvel agent sur cette page': ['Work done: new agent on this page', 'Trabajo terminado: nuevo agente en esta página', 'Arbeit erledigt: neuer Agent auf dieser Seite', '工作已完成：在此页面上启动新代理'],
  'Réflexion…': ['Thinking…', 'Pensando…', 'Denkt nach…', '思考中…'],
  'Beluga travaille…': ['Beluga is working…', 'Beluga está trabajando…', 'Beluga arbeitet…', 'Beluga 正在工作…'],
  'Relier ce Chrome à Beluga': ['Link this Chrome to Beluga', 'Vincular este Chrome a Beluga', 'Dieses Chrome mit Beluga verbinden', '将此 Chrome 关联到 Beluga'],
  'Dans Beluga, ouvrez Réglages → Extension, puis saisissez ici le code affiché.': [
    'In Beluga, open Settings → Extension, then enter the code shown here.',
    'En Beluga, abra Ajustes → Extensión e introduzca aquí el código mostrado.',
    'Öffnen Sie in Beluga Einstellungen → Erweiterung und geben Sie hier den angezeigten Code ein.',
    '在 Beluga 中打开 设置 → 扩展，然后在此输入显示的代码。',
  ],
  'Code de liaison': ['Link code', 'Código de vinculación', 'Verbindungscode', '关联代码'],
  'Nom de cet ordinateur': ['Name of this computer', 'Nombre de este ordenador', 'Name dieses Computers', '此电脑的名称'],
  Relier: ['Link', 'Vincular', 'Verbinden', '关联'],
  'Liaison…': ['Linking…', 'Vinculando…', 'Wird verbunden…', '正在关联…'],
  'Aucun agent ne travaille dans ce Chrome pour l’instant.': [
    'No agent is working in this Chrome yet.',
    'Ningún agente trabaja en este Chrome por ahora.',
    'Noch arbeitet kein Agent in diesem Chrome.',
    '目前没有代理在此 Chrome 中工作。',
  ],
  'Écrivez une demande ci-dessous : une carte se crée sur la page ouverte et part tout de suite.': [
    'Write a request below: a card is created for the open page and starts right away.',
    'Escriba una solicitud abajo: se crea una tarjeta sobre la página abierta y se lanza de inmediato.',
    'Schreiben Sie unten eine Anfrage: Für die geöffnete Seite entsteht eine Karte, die sofort startet.',
    '在下方写下请求：将为当前页面创建一张卡片并立即开始。',
  ],
  'Je prends la main': ['I’ll take over', 'Tomo el control', 'Ich übernehme', '我来接手'],
  'Rendre la main': ['Hand back', 'Devolver el control', 'Zurückgeben', '交还控制'],
  Arrêter: ['Stop', 'Detener', 'Anhalten', '停止'],
  'Répondre à l’agent…': ['Reply to the agent…', 'Responder al agente…', 'Dem Agenten antworten…', '回复代理…'],
  'Nouvelle demande sur cette page': ['New request on this page', 'Nueva solicitud en esta página', 'Neue Anfrage zu dieser Seite', '针对此页面的新请求'],
  'Que doit faire Beluga sur cette page ?': ['What should Beluga do on this page?', '¿Qué debe hacer Beluga en esta página?', 'Was soll Beluga auf dieser Seite tun?', 'Beluga 应在此页面上做什么？'],
  'L’onglet sera confié': ['The tab will be handed over', 'La pestaña será confiada', 'Der Tab wird übergeben', '该标签页将交给代理'],
  'Nouvelle demande': ['New request', 'Nueva solicitud', 'Neue Anfrage', '新请求'],
  'Répondre à l’agent': ['Reply to the agent', 'Responder al agente', 'Dem Agenten antworten', '回复代理'],
  'Hors ligne': ['Offline', 'Sin conexión', 'Offline', '离线'],
  'Délier ce Chrome': ['Unlink this Chrome', 'Desvincular este Chrome', 'Dieses Chrome trennen', '取消关联此 Chrome'],
  'Geste répété enregistré : {phrase}.': ['Repeated task saved: {phrase}.', 'Gesto repetido guardado: {phrase}.', 'Wiederholte Aufgabe gespeichert: {phrase}.', '已保存重复任务：{phrase}。'],
  'L’agent attend votre réponse': ['The agent is waiting for your answer', 'El agente espera su respuesta', 'Der Agent wartet auf Ihre Antwort', '代理正在等待您的回复'],
  'Votre réponse : {r}': ['Your answer: {r}', 'Su respuesta: {r}', 'Ihre Antwort: {r}', '您的回复：{r}'],
  'Une précision (facultatif)…': ['A detail (optional)…', 'Una precisión (opcional)…', 'Eine Ergänzung (optional)…', '补充说明（可选）…'],
  Envoyer: ['Send', 'Enviar', 'Senden', '发送'],
  'Choisir le projet': ['Choose the project', 'Elegir el proyecto', 'Projekt wählen', '选择项目'],
  '{n} à trancher': ['{n} to decide', '{n} por decidir', '{n} zu entscheiden', '{n} 项待决定'],
  'En cours': ['Working', 'En curso', 'Läuft', '进行中'],
  'En pause': ['Paused', 'En pausa', 'Pausiert', '已暂停'],
  'Vous avez la main': ['You have control', 'Usted tiene el control', 'Sie haben die Kontrolle', '您正在操作'],
  'Micro refusé : autorisez-le dans l’onglet qui vient de s’ouvrir, puis réessayez.': [
    'Microphone denied: allow it in the tab that just opened, then try again.',
    'Micrófono denegado: permítalo en la pestaña que se acaba de abrir y vuelva a intentarlo.',
    'Mikrofon abgelehnt: Erlauben Sie es im soeben geöffneten Tab und versuchen Sie es erneut.',
    '麦克风被拒绝：请在刚打开的标签页中允许，然后重试。',
  ],
  'Carte créée : elle part tout de suite.': ['Card created: it starts right away.', 'Tarjeta creada: se lanza de inmediato.', 'Karte erstellt: Sie startet sofort.', '卡片已创建：将立即开始。'],
  'Beluga est injoignable : vérifiez la connexion.': ['Beluga is unreachable: check the connection.', 'Beluga no responde: compruebe la conexión.', 'Beluga ist nicht erreichbar: Prüfen Sie die Verbindung.', '无法连接 Beluga：请检查网络。'],
  'Sélection jointe': ['Selection attached', 'Selección adjunta', 'Auswahl angehängt', '已附上所选内容'],
  'Dictée…': ['Dictating…', 'Dictando…', 'Diktat…', '正在听写…'],
  Code: ['Code', 'Código', 'Code', '代码'],
  Sommaire: ['Contents', 'Índice', 'Inhalt', '目录'],
  Conseil: ['Tip', 'Consejo', 'Tipp', '提示'],
  Note: ['Note', 'Nota', 'Hinweis', '注意'],
  Important: ['Important', 'Importante', 'Wichtig', '重要'],
  Attention: ['Warning', 'Atención', 'Achtung', '警告'],
  Risque: ['Risk', 'Riesgo', 'Risiko', '风险'],
  'A utilisé Chrome (1 action)': ['Used Chrome (1 action)', 'Usó Chrome (1 acción)', 'Hat Chrome benutzt (1 Aktion)', '使用了 Chrome（1 个操作）'],
  'A utilisé Chrome ({n} actions)': ['Used Chrome ({n} actions)', 'Usó Chrome ({n} acciones)', 'Hat Chrome benutzt ({n} Aktionen)', '使用了 Chrome（{n} 个操作）'],
  'A travaillé (1 étape)': ['Worked (1 step)', 'Trabajó (1 paso)', 'Hat gearbeitet (1 Schritt)', '已处理（1 个步骤）'],
  'A travaillé ({n} étapes)': ['Worked ({n} steps)', 'Trabajó ({n} pasos)', 'Hat gearbeitet ({n} Schritte)', '已处理（{n} 个步骤）'],
  '… et {n} étapes plus tôt': ['… and {n} earlier steps', '… y {n} pasos anteriores', '… und {n} frühere Schritte', '……以及之前的 {n} 个步骤'],
  'Film du travail · {nom}': ['Work recording · {nom}', 'Vídeo del trabajo · {nom}', 'Arbeitsvideo · {nom}', '工作录像 · {nom}'],
  '{agent} agit sur « {titre} »': ['{agent} is working on “{titre}”', '{agent} actúa en «{titre}»', '{agent} arbeitet in „{titre}“', '{agent} 正在操作「{titre}」'],
  'L’agent': ['The agent', 'El agente', 'Der Agent', '代理'],
  'un onglet': ['a tab', 'una pestaña', 'einem Tab', '一个标签页'],
  'Y aller': ['Go there', 'Ir allí', 'Hingehen', '前往'],
  Annuler: ['Cancel', 'Cancelar', 'Abbrechen', '取消'],
  'à l’instant': ['just now', 'ahora mismo', 'gerade eben', '刚刚'],
  'il y a {n} min': ['{n} min ago', 'hace {n} min', 'vor {n} Min.', '{n} 分钟前'],
  'il y a {n} h': ['{n} h ago', 'hace {n} h', 'vor {n} Std.', '{n} 小时前'],
  'il y a {n} j': ['{n} d ago', 'hace {n} d', 'vor {n} T.', '{n} 天前'],
  '{date} à {heure}': ['{date} at {heure}', '{date} a las {heure}', '{date} um {heure}', '{date} {heure}'],
};

const RANG = { en: 0, es: 1, de: 2, zh: 3 };
let langue = 'fr';

export function poserLaLangue(l) {
  langue = RANG[l] !== undefined ? l : 'fr';
  if (globalThis.document) document.documentElement.lang = langue;
}

/** La langue du panneau (« fr », « en »…) : les dates et les heures se forment dans celle-ci. */
export function langueDuPanneau() {
  return langue;
}

export function t(texte, valeurs = {}) {
  const traduit = langue === 'fr' ? texte : (TEXTES[texte]?.[RANG[langue]] ?? texte);
  return traduit.replace(/\{(\w+)\}/g, (_, k) => (valeurs[k] !== undefined ? String(valeurs[k]) : `{${k}}`));
}
