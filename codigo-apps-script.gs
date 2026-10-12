/* Equilibra - servidor de sincronização v2 (Google Apps Script)
   Não tem senha: cada celular recebe uma chave própria, criada pelo app, e o
   servidor só guarda o "hash" dela. Para conectar o segundo celular, o primeiro
   mostra um QR (convite de uso único, vale 10 minutos) e autoriza com a digital.

   Publicar a primeira vez: Implantar > Nova implantação > App da Web
     Executar como: Eu | Quem tem acesso: Qualquer pessoa
   Atualizar: Implantar > Gerenciar implantações > lápis > Versão: Nova versão > Implantar
     (o endereço que termina em /exec continua o mesmo)

   Os dados ficam no arquivo "Equilibra - dados v2.json" do SEU Google Drive.
   Para começar do zero, mova esse arquivo para a lixeira. */
const MIN_CONVITE = 10;

function doGet() { return resp_({ ok: true, msg: 'Equilibra no ar (v2).' }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) { return resp_({ ok: false, erro: 'ocupado' }); }
  try {
    const req = JSON.parse(e.postData.contents);
    const arq = arquivo_();
    const db = JSON.parse(arq.getBlob().getDataAsString() || '{}');
    const r = processar_(db, req || {}, Date.now());
    if (r.salvar) arq.setContent(JSON.stringify(db));
    return resp_(r.res);
  } catch (err) {
    return resp_({ ok: false, erro: 'dados' });
  } finally {
    lock.releaseLock();
  }
}

function processar_(db, req, agora) {
  db.espacos = db.espacos || {};
  const ok = (res, salvar) => ({ res: Object.assign({ ok: true }, res), salvar: !!salvar });
  const erro = e => ({ res: { ok: false, erro: e }, salvar: false });
  const valido = t => typeof t === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(t);
  const vivo = c => !!c && c.expira > agora;

  /* o primeiro celular cria o espaço; depois disso ninguém mais cria */
  if (req.acao === 'criar') {
    if (!valido(req.t) || (req.autor !== 'a' && req.autor !== 'b')) return erro('dados');
    if (Object.keys(db.espacos).length) return erro('ja-configurado');
    const esp = Utilities.getUuid().replace(/-/g, '');
    db.espacos[esp] = { tok: {}, dados: {} };
    db.espacos[esp].tok[req.autor] = hash_(req.t);
    return ok({ espaco: esp }, true);
  }

  /* o segundo celular leu o QR: fica esperando a autorização */
  if (req.acao === 'entrar') {
    if (!valido(req.t) || !valido(req.p)) return erro('dados');
    const hp = hash_(req.p), ht = hash_(req.t);
    for (const k in db.espacos) {
      const c = db.espacos[k].convite;
      if (!vivo(c) || c.ph !== hp) continue;
      if (c.pedido && c.pedido.th !== ht) return erro('convite-usado');
      if (!c.pedido) c.pedido = { th: ht, ts: agora };
      return ok({ estado: 'aguardando' }, true);
    }
    return erro('convite-invalido');
  }

  /* daqui para baixo: quem é a pessoa sai da chave dela, nunca do que o celular diz */
  if (!valido(req.t)) return erro('chave');
  const ht = hash_(req.t);
  let esp = null, sp = null, autor = null;
  for (const k in db.espacos) {
    const s = db.espacos[k];
    if (s.tok.a === ht) { esp = k; sp = s; autor = 'a'; break; }
    if (s.tok.b === ht) { esp = k; sp = s; autor = 'b'; break; }
  }
  if (!sp) {
    for (const k in db.espacos) {
      const c = db.espacos[k].convite;
      if (vivo(c) && c.pedido && c.pedido.th === ht) return erro('aguardando');
    }
    return erro('chave');
  }
  const outro = autor === 'a' ? 'b' : 'a';

  if (req.acao === 'sync') {
    let salvar = false;
    if (req.meu) {
      const m = req.meu;
      if (!Array.isArray(m.eventos) || !m.config) return erro('dados');
      /* junta os eventos novos com os que já estavam: o servidor nunca apaga nada */
      const atual = sp.dados[autor] || { eventos: [] }, ids = Object.create(null);
      atual.eventos.forEach(ev => { ids[ev.id] = true; });
      m.eventos.forEach(ev => {
        if (ev && typeof ev.id === 'string' && ev.autor === autor && !ids[ev.id]) { atual.eventos.push(ev); ids[ev.id] = true; }
      });
      sp.dados[autor] = { v: m.v, autor: autor, config: m.config, eventos: atual.eventos, atualizado: agora };
      salvar = true;
    }
    const res = { espaco: esp, outro: sp.dados[outro] || null };
    if (req.recuperar) res.meu = sp.dados[autor] || null;
    const c = sp.convite;
    if (vivo(c) && c.de === autor && c.pedido) res.pedido = { id: c.id, ts: c.pedido.ts };
    return ok(res, salvar);
  }

  /* convite para a outra pessoa (o QR); um convite novo substitui o anterior */
  if (req.acao === 'convite') {
    if (!valido(req.p)) return erro('dados');
    sp.convite = { id: Utilities.getUuid(), de: autor, para: outro, ph: hash_(req.p), expira: agora + MIN_CONVITE * 60000, pedido: null };
    return ok({ expira: sp.convite.expira }, true);
  }

  /* quem convidou autoriza (com a digital, no celular) ou recusa;
     autorizar troca a chave da outra pessoa: o celular antigo dela deixa de funcionar */
  if (req.acao === 'aprovar') {
    const c = sp.convite;
    if (!vivo(c) || c.de !== autor || c.id !== req.id || !c.pedido) return erro('convite-invalido');
    if (req.sim === true) sp.tok[c.para] = c.pedido.th;
    delete sp.convite;
    return ok({}, true);
  }

  return erro('dados');
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function arquivo_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('ARQ2');
  if (id) {
    try { const f = DriveApp.getFileById(id); if (!f.isTrashed()) return f; } catch (err) {}
  }
  const f = DriveApp.createFile('Equilibra - dados v2.json', '{"espacos":{}}', MimeType.PLAIN_TEXT);
  p.setProperty('ARQ2', f.getId());
  return f;
}

function resp_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
