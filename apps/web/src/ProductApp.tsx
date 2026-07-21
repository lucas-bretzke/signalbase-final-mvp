import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import './styles.css';
import {
  createLeadSearch,
  deleteLeadSearch,
  exportLeadSearch,
  getAppCapabilities,
  getLeadSearch,
  getLeadSearchResult,
  listLeadSearches,
  listLeadSearchResults,
  pauseLeadSearch,
  reprocessLeadSearch,
  resumeLeadSearch,
  testLinkedin,
  updateLeadSearchResultSelection,
} from './api';
import {
  CreateLeadSearchInput,
  EmailTypeFilter,
  EvidenceItem,
  LeadCrossMatchSnapshot,
  LeadQualityLevel,
  LeadSearch,
  LeadSearchResult,
  LinkedinDiagnostic,
} from './types';
import { BrandLogo } from './BrandLogo';

type View = 'dashboard' | 'new-search' | 'searches' | 'review' | 'detail' | 'exports';

interface RouteState {
  view: View;
  searchId?: string;
  resultId?: string;
}

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const NAV_ITEMS: Array<{ view: View; label: string; caption: string; icon: string }> = [
  { view: 'dashboard', label: 'Dashboard', caption: 'Visão geral', icon: '⌂' },
  { view: 'new-search', label: 'Nova Busca', caption: 'Criar recorte', icon: '+' },
  { view: 'searches', label: 'Buscas em Andamento', caption: 'Acompanhar jobs', icon: '◷' },
  { view: 'review', label: 'Revisão de Leads', caption: 'Validar contatos', icon: '✓' },
  { view: 'detail', label: 'Detalhes do Lead', caption: 'Evidências e score', icon: '◎' },
  { view: 'exports', label: 'Exportações', caption: 'Gerar listas finais', icon: '⇩' },
];

function ProductApp() {
  const [route, setRoute] = useState<RouteState>(() => readRoute());
  const [searches, setSearches] = useState<LeadSearch[]>([]);
  const [loadingSearches, setLoadingSearches] = useState(true);
  const [globalError, setGlobalError] = useState<string>();
  const [linkedinDiagnostic, setLinkedinDiagnostic] = useState<LinkedinDiagnostic>({ ok: false, ready: false, sessionState: 'not_checked' });
  const [linkedinConfigured, setLinkedinConfigured] = useState<boolean | undefined>();
  const [linkedinReady, setLinkedinReady] = useState(false);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [testingLinkedin, setTestingLinkedin] = useState(false);

  const loadSearches = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingSearches(true);
    try {
      const page = await listLeadSearches({ page: 1, pageSize: 100 });
      setSearches(page.items);
      setGlobalError(undefined);
    } catch (error) {
      setGlobalError(errorMessage(error));
    } finally {
      if (!quiet) setLoadingSearches(false);
    }
  }, []);

  const handleSearchUpdate = useCallback((updated: LeadSearch) => {
    setSearches((items) => items.some((item) => item.id === updated.id)
      ? items.map((item) => item.id === updated.id ? updated : item)
      : [updated, ...items]);
  }, []);

  const handleSearchDelete = useCallback((id: string) => {
    setSearches((items) => items.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    void loadSearches();
    const timer = window.setInterval(() => void loadSearches(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadSearches]);

  const loadLinkedinDiagnostic = useCallback(async () => {
    try {
      const capabilities = await getAppCapabilities();
      setLinkedinConfigured(capabilities.linkedin.enabled);
      setLinkedinReady(capabilities.linkedin.enabled && capabilities.linkedin.ready && capabilities.quality.muito_alto);
      setLinkedinDiagnostic({
        ok: capabilities.linkedin.implementation === 'puppeteer' || capabilities.linkedin.mode === 'demo',
        ready: capabilities.linkedin.ready,
        enabled: capabilities.linkedin.enabled,
        implementation: capabilities.linkedin.implementation,
        mode: capabilities.linkedin.mode,
        runtimeMode: capabilities.linkedin.runtimeMode,
        sessionState: capabilities.linkedin.sessionState,
        headless: capabilities.linkedin.headless,
        lastCheckedAt: capabilities.linkedin.lastCheckedAt,
        lastError: capabilities.linkedin.lastError,
        errorCode: capabilities.linkedin.errorCode,
      });
    } catch (error) {
      setLinkedinConfigured(undefined);
      setLinkedinReady(false);
      setLinkedinDiagnostic({ ok: false, ready: false, error: errorMessage(error), errorCode: 'worker_unavailable' });
    }
  }, []);

  useEffect(() => {
    void loadLinkedinDiagnostic();
    const timer = window.setInterval(() => void loadLinkedinDiagnostic(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadLinkedinDiagnostic]);

  async function runLinkedinTest() {
    setTestingLinkedin(true);
    try {
      setLinkedinDiagnostic(await testLinkedin());
      await loadLinkedinDiagnostic();
    }
    catch (error) {
      setLinkedinReady(false);
      setLinkedinDiagnostic({ ok: false, ready: false, error: errorMessage(error), errorCode: 'worker_unavailable' });
    }
    finally { setTestingLinkedin(false); }
  }

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(view: View, searchId?: string, resultId?: string) {
    const next = { view, searchId, resultId };
    window.history.pushState(next, '', routePath(next));
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const contextualSearchId = route.searchId ?? searches[0]?.id;

  return (
    <div className="product-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('dashboard')} aria-label="Ir para o Dashboard">
          <BrandLogo inverse />
        </button>
        <nav className="main-nav" aria-label="Navegação principal">
          <span className="nav-eyebrow">Workspace</span>
          {NAV_ITEMS.map((item) => {
            const requiresContext = item.view === 'review' || item.view === 'detail';
            const disabled = requiresContext && !contextualSearchId;
            const active = route.view === item.view;
            return (
              <button
                key={item.view}
                className={active ? 'nav-item active' : 'nav-item'}
                disabled={disabled}
                onClick={() => {
                  if (item.view === 'detail') {
                    const resultId = route.resultId;
                    if (contextualSearchId && resultId) navigate('detail', contextualSearchId, resultId);
                    else if (contextualSearchId) navigate('review', contextualSearchId);
                  } else if (item.view === 'review') navigate('review', contextualSearchId);
                  else navigate(item.view, item.view === 'exports' ? contextualSearchId : undefined);
                }}
              >
                <span className="nav-icon">{item.icon}</span>
                <span><strong>{item.label}</strong><small>{item.caption}</small></span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-help">
          <span className="help-icon">?</span>
          <div><strong>Precisa de ajuda?</strong><small>Consulte o guia do projeto.</small></div>
          <a href="/docs/COMO-FUNCIONA.md" target="_blank" rel="noreferrer">Abrir guia</a>
        </div>
        <button className={`sidebar-foot linkedin-runtime ${linkedinStatusOf(linkedinDiagnostic).tone}`} onClick={() => setDiagnosticOpen(true)}>
          <span className="health-dot" /> {linkedinStatusOf(linkedinDiagnostic).label}
        </button>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><BrandLogo /></div>
          <div className="crumbs"><span>EconoSense</span><b>/</b><strong>{pageTitle(route.view)}</strong></div>
          <div className="topbar-actions">
            <button className="icon-button" title="Atualizar dados" onClick={() => void loadSearches()} aria-label="Atualizar">↻</button>
            <div className="account"><span>SB</span><div><strong>Operação comercial</strong><small>Workspace principal</small></div></div>
          </div>
        </header>

        <main className="page" aria-live="polite">
          {globalError && <Notice tone="error" onClose={() => setGlobalError(undefined)}>{globalError}</Notice>}
          {route.view === 'dashboard' && (
            <DashboardPage searches={searches} loading={loadingSearches} navigate={navigate} />
          )}
          {route.view === 'new-search' && (
            <NewSearchPage linkedinConfigured={linkedinConfigured} linkedinReady={linkedinReady} onCreated={(search) => {
              setSearches((items) => [search, ...items.filter((item) => item.id !== search.id)]);
              navigate('review', search.id);
            }} />
          )}
          {route.view === 'searches' && (
            <SearchesPage searches={searches} loading={loadingSearches} onRefresh={() => void loadSearches()} navigate={navigate} onSearchUpdate={handleSearchUpdate} onSearchDelete={handleSearchDelete} />
          )}
          {route.view === 'review' && route.searchId && (
            <ReviewPage searchId={route.searchId} navigate={navigate} onSearchUpdate={handleSearchUpdate} onSearchDelete={handleSearchDelete} />
          )}
          {route.view === 'review' && !route.searchId && <ContextEmpty navigate={navigate} />}
          {route.view === 'detail' && route.searchId && route.resultId && (
            <LeadDetailPage searchId={route.searchId} resultId={route.resultId} navigate={navigate} />
          )}
          {route.view === 'detail' && (!route.searchId || !route.resultId) && <ContextEmpty navigate={navigate} />}
          {route.view === 'exports' && (
            <ExportsPage searches={searches} initialSearchId={route.searchId} navigate={navigate} />
          )}
        </main>
      </div>
      {diagnosticOpen && (
        <div className="diagnostic-backdrop" role="presentation" onClick={() => setDiagnosticOpen(false)}>
          <section className="diagnostic-dialog" role="dialog" aria-modal="true" aria-label="Diagnóstico do LinkedIn" onClick={(event) => event.stopPropagation()}>
            <div className="diagnostic-title"><div><span className={`health-dot ${linkedinStatusOf(linkedinDiagnostic).tone}`} /><strong>{linkedinStatusOf(linkedinDiagnostic).label}</strong></div><button className="icon-button" onClick={() => setDiagnosticOpen(false)} aria-label="Fechar">×</button></div>
            <dl><div><dt>Implementação</dt><dd>{linkedinDiagnostic.implementation || 'Indisponível'}</dd></div><div><dt>Modo</dt><dd>{linkedinDiagnostic.runtimeMode || linkedinDiagnostic.mode || 'Desconhecido'}</dd></div><div><dt>Sessão</dt><dd>{linkedinDiagnostic.sessionState || linkedinDiagnostic.session_state || 'Não testada'}</dd></div><div><dt>Navegador</dt><dd>{linkedinDiagnostic.headless === undefined ? 'Desconhecido' : linkedinDiagnostic.headless ? 'Oculto' : 'Visível'}</dd></div><div><dt>Último teste</dt><dd>{formatDiagnosticDate(linkedinDiagnostic)}</dd></div></dl>
            {(linkedinDiagnostic.lastError || linkedinDiagnostic.last_error || linkedinDiagnostic.error) && <div className="diagnostic-error">{linkedinDiagnostic.lastError || linkedinDiagnostic.last_error || linkedinDiagnostic.error}</div>}
            <button className="button primary full" disabled={testingLinkedin} onClick={() => void runLinkedinTest()}>{testingLinkedin ? 'Testando conexão…' : 'Testar LinkedIn'}</button>
          </section>
        </div>
      )}
    </div>
  );
}

function DashboardPage({ searches, loading, navigate }: {
  searches: LeadSearch[];
  loading: boolean;
  navigate: (view: View, searchId?: string, resultId?: string) => void;
}) {
  const totalLeads = searches.reduce((sum, item) => sum + item.totalValidLeads, 0);
  const totalProcessed = searches.reduce((sum, item) => sum + item.totalProcessed, 0);
  const active = searches.filter((item) => isActive(item.status)).length;
  const yieldRate = totalProcessed ? (totalLeads / totalProcessed) * 100 : 0;

  return (
    <>
      <section className="page-heading heading-actions">
        <div><span className="eyebrow">Visão geral</span><h1>Seu motor de prospecção, em um só lugar.</h1><p>Acompanhe buscas, rendimento e contatos validados a partir da base local.</p></div>
        <button className="button primary" onClick={() => navigate('new-search')}><span>＋</span> Criar nova busca</button>
      </section>

      <section className="metric-grid">
        <MetricCard label="Buscas ativas" value={active} detail={`${searches.length} no histórico`} tone="blue" icon="◷" />
        <MetricCard label="Leads válidos" value={totalLeads} detail="Prontos para revisão" tone="green" icon="✓" />
        <MetricCard label="Empresas processadas" value={totalProcessed} detail="Candidatas enriquecidas" tone="violet" icon="⌁" />
        <MetricCard label="Aproveitamento médio" value={`${formatNumber(yieldRate, 1)}%`} detail="Válidos ÷ processados" tone="amber" icon="↗" />
      </section>

      <section className="dashboard-grid">
        <div className="panel recent-panel">
          <PanelHeader eyebrow="Atividade recente" title="Buscas mais recentes" action={<button className="text-button" onClick={() => navigate('searches')}>Ver todas →</button>} />
          {loading ? <LoadingRows /> : searches.length ? (
            <div className="search-card-list">
              {searches.slice(0, 5).map((search) => (
                <button className="search-row" key={search.id} onClick={() => navigate('review', search.id)}>
                  <span className="search-symbol">{search.uf}</span>
                  <span className="search-main"><strong>{search.city || `Todo o estado de ${search.uf}`}</strong><small>{search.cnaes.join(' · ')} · criada {formatRelative(search.createdAt)}</small></span>
                  <span className="search-target"><strong>{search.totalValidLeads}/{targetLabelOf(search)}</strong><small>{isMaxTarget(search) ? 'máximo possível' : 'leads válidos'}</small></span>
                  <span className="row-progress"><i style={{ width: `${progressValueOf(search)}%` }} /></span>
                  <StatusBadge status={search.status} />
                  <span className="row-arrow">›</span>
                </button>
              ))}
            </div>
          ) : <EmptyState icon="⌕" title="Nenhuma busca criada" text="Defina seu primeiro recorte por UF, cidade e CNAE." action={<button className="button primary" onClick={() => navigate('new-search')}>Criar busca</button>} />}
        </div>

        <aside className="panel insight-panel">
          <span className="insight-badge">Como a meta funciona</span>
          <h2>Você pede contatos.<br />Nós processamos empresas.</h2>
          <p>A quantidade desejada representa leads finais que passaram por score e filtros — não o total de CNPJs examinados.</p>
          <div className="funnel-mini">
            <FunnelLine label="Candidatas conhecidas" value={formatNumber(searches.reduce((sum, item) => sum + item.totalCandidatesFound, 0))} width="100%" />
            <FunnelLine label="Processadas" value={totalProcessed} width="75%" />
            <FunnelLine label="Leads válidos" value={totalLeads} width="48%" accent />
          </div>
          <button className="button soft full" onClick={() => navigate('new-search')}>Definir um novo mercado →</button>
        </aside>
      </section>
    </>
  );
}

function NewSearchPage({ linkedinConfigured, linkedinReady, onCreated }: {
  linkedinConfigured: boolean | undefined;
  linkedinReady: boolean;
  onCreated: (search: LeadSearch) => void;
}) {
  const [uf, setUf] = useState('SC');
  const [city, setCity] = useState('');
  const [rawCnaes, setRawCnaes] = useState('7311400, 7319002');
  const [targetQuantityInput, setTargetQuantityInput] = useState('100');
  const [minQuality, setMinQuality] = useState<LeadQualityLevel>('alto');
  const [requirePhone, setRequirePhone] = useState(true);
  const [requireEmail, setRequireEmail] = useState(false);
  const [requireDecisionMakerMatch, setRequireDecisionMakerMatch] = useState(false);
  const [onlyMobilePhone, setOnlyMobilePhone] = useState(false);
  const [emailType, setEmailType] = useState<EmailTypeFilter>('any');
  const [excludeGenericContacts, setExcludeGenericContacts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const cnaes = useMemo(() => parseCnaes(rawCnaes), [rawCnaes]);
  const invalidCnaes = useMemo(() => rawCnaes.split(/[\s,;]+/).filter(Boolean).filter((value) => value.replace(/\D/g, '').length !== 7), [rawCnaes]);
  const effectiveRequireEmail = requireEmail || emailType !== 'any';
  const qualityHint = qualityLevelHint(minQuality);
  const qualityRules = qualityRuleLabels(minQuality, linkedinReady);
  const linkedinUnavailableText = linkedinConfigured === false
    ? 'Ative LINKEDIN_ENABLED para disponibilizar este recurso.'
    : linkedinConfigured === true
      ? 'O worker do LinkedIn ainda nao esta pronto.'
      : 'Nao foi possivel confirmar a disponibilidade do worker do LinkedIn.';
  const citySearch = Boolean(city.trim());
  const targetIsMax = targetQuantityInput.trim().toLowerCase() === 'max';
  const parsedTargetQuantity = Number(targetQuantityInput);
  const targetQuantity = targetIsMax ? 0 : parsedTargetQuantity;
  const targetLabel = targetIsMax ? 'max' : (Number.isFinite(parsedTargetQuantity) && parsedTargetQuantity > 0 ? formatNumber(parsedTargetQuantity) : '0');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (!UFS.includes(uf)) return setError('Selecione uma UF válida.');
    if (!cnaes.length || invalidCnaes.length) return setError('Informe ao menos um CNAE válido com sete dígitos.');
    if (cnaes.length > 50) return setError('Informe no máximo 50 CNAEs por busca.');
    if (!targetIsMax && (!Number.isInteger(parsedTargetQuantity) || parsedTargetQuantity < 1)) return setError('A quantidade desejada deve ser um número maior que zero ou max.');
    if (!targetIsMax && parsedTargetQuantity > 10_000) return setError('A quantidade desejada deve ser de no máximo 10.000 leads.');
    if (!linkedinReady && (minQuality === 'muito_alto' || requireDecisionMakerMatch)) {
      return setError('Os criterios selecionados exigem o worker do LinkedIn pronto. Suas escolhas foram preservadas.');
    }
    const input: CreateLeadSearchInput = {
      uf, city: city.trim() || undefined, cnaes, targetQuantity: targetIsMax ? 'max' : targetQuantity, targetMode: targetIsMax ? 'max' : 'fixed', minQuality,
      requirePhone, requireEmail, requireDecisionMakerMatch,
      onlyMobilePhone, emailType, onlyCorporateEmail: emailType === 'corporate', excludeGenericContacts,
    };
    setSubmitting(true);
    try {
      onCreated(await createLeadSearch(input));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="page-heading"><span className="eyebrow">Nova Busca</span><h1>Encontre os leads certos para o seu mercado.</h1><p>Defina o recorte. A EconoSense encontra as empresas e enriquece até atingir sua meta de contatos válidos.</p></section>
      <form className="new-search-layout" onSubmit={submit}>
        <div className="form-stack">
          <section className="panel form-section">
            <SectionTitle number="01" title="Onde estão as empresas?" text="A UF é obrigatória; deixe a cidade vazia para cobrir o estado inteiro." />
            <div className="field-grid two">
              <label className="field"><span>Estado / UF <b>*</b></span><select value={uf} onChange={(event) => setUf(event.target.value)}>{UFS.map((item) => <option key={item}>{item}</option>)}</select><small>Obrigatório</small></label>
              <label className="field"><span>Cidade <em>opcional</em></span><input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Ex.: Florianópolis" /><small>Vazio = estado inteiro</small></label>
            </div>
          </section>

          <section className="panel form-section">
            <SectionTitle number="02" title="Qual é o segmento?" text="Use um ou vários CNAEs. A busca considera empresas que correspondam a qualquer código." />
            <label className="field"><span>CNAE ou lista de CNAEs <b>*</b></span><textarea className="cnae-input" value={rawCnaes} onChange={(event) => setRawCnaes(event.target.value)} placeholder="7311400, 7319002, 7319003" /><small>Separe por vírgula, espaço ou nova linha. Pontuação será removida.</small></label>
            <div className="tag-row">{cnaes.map((cnae) => <span className="tag" key={cnae}>{cnae}</span>)}{!cnaes.length && <span className="tag muted">Nenhum CNAE válido</span>}</div>
          </section>

          <section className="panel form-section">
            <SectionTitle number="03" title="O que conta como um lead válido?" text="A meta só avança quando todos os critérios selecionados forem atendidos." />
            <div className="field-grid two quantity-fields">
              <label className="field"><span>Quantidade desejada <b>*</b></span><div className="input-suffix"><input value={targetQuantityInput} onChange={(event) => setTargetQuantityInput(event.target.value)} placeholder="100 ou max" /><i>{targetIsMax ? 'tudo' : 'contatos'}</i></div><small>Use max para processar todas as candidatas {citySearch ? 'da cidade' : 'do estado'}; país inteiro ainda não.</small></label>
              <label className="field"><span>Qualidade mínima <em>opcional</em></span><div className="quality-control" role="group" aria-label="Qualidade mínima">{(['baixo', 'medio', 'alto', 'muito_alto'] as LeadQualityLevel[]).map((level) => { const unavailable = level === 'muito_alto' && !linkedinReady; return <button key={level} type="button" className={minQuality === level ? 'active' : ''} disabled={unavailable} title={unavailable ? linkedinUnavailableText : undefined} onClick={() => setMinQuality(level)}>{qualityLevelLabel(level)}</button>; })}</div><small>{linkedinReady ? 'Leads abaixo deste nível são rejeitados.' : linkedinUnavailableText}</small><div className={`score-impact ${qualityHint.tone}`}><span><i style={{ width: `${qualityHint.coverage}%` }} /></span><strong>{qualityHint.label}</strong><small>{qualityHint.text}</small></div><div className="quality-rules"><strong>{linkedinReady ? 'Automático com LinkedIn' : 'Validação sem LinkedIn pronto'}</strong>{qualityRules.map((rule) => <small key={rule}>{rule}</small>)}</div></label>
            </div>
            <div className="check-grid">
              <CheckCard checked={requirePhone} onChange={setRequirePhone} icon="☎" title="Exigir telefone" text="Só aceita lead com número tecnicamente válido." />
              <CheckCard checked={effectiveRequireEmail} onChange={(value) => { setRequireEmail(value); if (!value) setEmailType('any'); }} icon="@" title="Exigir e-mail" text="Só aceita lead com endereço tecnicamente válido." />
              <CheckCard checked={requireDecisionMakerMatch} onChange={setRequireDecisionMakerMatch} disabled={!linkedinReady && !requireDecisionMakerMatch} icon="≋" title="Decisor validado" text={linkedinReady ? 'Exige correspondência entre sócio e decisor.' : linkedinUnavailableText} />
            </div>
            <details className="advanced-filters">
              <summary>Filtros avançados <span>Mais precisão para os contatos finais</span></summary>
              <div className="advanced-grid">
                <Toggle checked={onlyMobilePhone} onChange={(value) => { setOnlyMobilePhone(value); if (value) setRequirePhone(true); }} label="Somente celular" info="Mantém apenas telefones móveis; telefones fixos válidos deixam de contar na meta." infoPlacement="right" />
                <div className="filter-option email-type-filter">
                  <div className="filter-label"><span>E-mails aceitos</span><InfoHint text="Corporativos usam domínio da empresa; não corporativos incluem provedores pessoais como Gmail, Hotmail e Outlook." placement="left" /></div>
                  <div className="option-segmented" role="group" aria-label="Tipo de e-mail aceito">
                    <button type="button" className={emailType === 'corporate' ? 'active' : ''} onClick={() => { setEmailType('corporate'); setRequireEmail(true); }}>Corporativos</button>
                    <button type="button" className={emailType === 'non_corporate' ? 'active' : ''} onClick={() => { setEmailType('non_corporate'); setRequireEmail(true); }}>Não corporativos</button>
                    <button type="button" className={emailType === 'any' ? 'active' : ''} onClick={() => setEmailType('any')}>Ambos</button>
                  </div>
                </div>
                <Toggle checked={excludeGenericContacts} onChange={setExcludeGenericContacts} label="Excluir contatos genéricos" info="Remove caixas como contato@, vendas@ e suporte@ quando elas seriam o e-mail final." infoPlacement="left" />
              </div>
            </details>
            {error && <Notice tone="error">{error}</Notice>}
          </section>

          <div className="form-actions"><span>Você poderá revisar e exportar os resultados parciais.</span><button className="button primary large" disabled={submitting}>{submitting ? 'Criando busca…' : 'Criar busca'} <b>→</b></button></div>
        </div>

        <aside className="search-summary panel">
          <span className="eyebrow">Resumo do recorte</span><h2>{city || `Estado de ${uf}`} <small>{uf}</small></h2>
          <div className="summary-block"><span>CNAEs</span><strong>{cnaes.length || 0} segmento{cnaes.length === 1 ? '' : 's'}</strong></div>
          <div className="target-visual"><span>Meta final</span><strong>{targetLabel}</strong><small>{targetIsMax ? 'máximo possível' : 'leads válidos'}</small></div>
          <div className="criteria-list"><Criteria active text={`Qualidade mínima: ${qualityLevelLabel(minQuality)}`} />{qualityRules.slice(0, 3).map((rule) => <Criteria key={rule} active text={rule} />)}<Criteria active={requirePhone} text={onlyMobilePhone ? 'Celular obrigatório' : 'Telefone obrigatório'} /><Criteria active={effectiveRequireEmail} text={emailCriteriaText(emailType)} /><Criteria active={requireDecisionMakerMatch} text="Sócio × decisor validado" /><Criteria active={excludeGenericContacts} text="Sem contatos genéricos" /></div>
          <div className="summary-note"><strong>Por que podem ser processadas mais empresas?</strong><p>{targetIsMax ? `No modo max, o job processa todas as candidatas ${citySearch ? 'da cidade' : 'do estado'} e entrega todos os leads que passarem pelos filtros.` : `Empresas sem contato, score ou match suficiente não contam na meta. O job continua até chegar a ${targetLabel} leads ou esgotar as candidatas.`}</p></div>
        </aside>
      </form>
    </>
  );
}

function SearchesPage({ searches, loading, onRefresh, navigate, onSearchUpdate, onSearchDelete }: {
  searches: LeadSearch[]; loading: boolean; onRefresh: () => void;
  navigate: (view: View, searchId?: string, resultId?: string) => void;
  onSearchUpdate: (search: LeadSearch) => void;
  onSearchDelete: (id: string) => void;
}) {
  const [filter, setFilter] = useState('all');
  const [actionId, setActionId] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const shown = searches.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'processing') return isActive(item.status);
    if (filter === 'exhausted') return poolExhausted(item);
    if (filter === 'completed') return statusKey(item.status) === 'completed' && !poolExhausted(item);
    return statusKey(item.status) === filter;
  });
  async function pauseSearch(search: LeadSearch) {
    setActionId(search.id); setActionError(undefined);
    try { onSearchUpdate(await pauseLeadSearch(search.id)); }
    catch (cause) { setActionError(errorMessage(cause)); }
    finally { setActionId(undefined); }
  }
  async function resumeSearch(search: LeadSearch) {
    setActionId(search.id); setActionError(undefined);
    try { onSearchUpdate(await resumeLeadSearch(search.id)); }
    catch (cause) { setActionError(errorMessage(cause)); }
    finally { setActionId(undefined); }
  }
  async function removeSearch(search: LeadSearch) {
    if (!window.confirm('Excluir esta busca e todos os resultados salvos? Esta ação não pode ser desfeita.')) return;
    setActionId(search.id); setActionError(undefined);
    try { await deleteLeadSearch(search.id); onSearchDelete(search.id); }
    catch (cause) { setActionError(errorMessage(cause)); }
    finally { setActionId(undefined); }
  }
  return (
    <>
      <section className="page-heading heading-actions"><div><span className="eyebrow">Operação</span><h1>Buscas em andamento</h1><p>Acompanhe o funil real entre candidatas processadas e contatos finais.</p></div><div className="heading-buttons"><button className="button secondary" onClick={onRefresh}>↻ Atualizar</button><button className="button primary" onClick={() => navigate('new-search')}>＋ Nova busca</button></div></section>
      {actionError && <Notice tone="error" onClose={() => setActionError(undefined)}>{actionError}</Notice>}
      <section className="panel table-panel">
        <div className="toolbar"><div className="segmented"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas <b>{searches.length}</b></button><button className={filter === 'processing' ? 'active' : ''} onClick={() => setFilter('processing')}>Em andamento <b>{searches.filter((s) => isActive(s.status)).length}</b></button><button className={filter === 'paused' ? 'active' : ''} onClick={() => setFilter('paused')}>Pausadas <b>{searches.filter((s) => statusKey(s.status) === 'paused').length}</b></button><button className={filter === 'completed' ? 'active' : ''} onClick={() => setFilter('completed')}>Concluídas</button><button className={filter === 'exhausted' ? 'active' : ''} onClick={() => setFilter('exhausted')}>Esgotadas</button></div></div>
        <div className="yield-guidance"><span aria-hidden="true">i</span><p><strong>Aproveitamento baixo não significa resultado ruim.</strong> Uma taxa menor pode indicar uma filtragem mais rigorosa: boa parte dos candidatos sem qualidade suficiente foi removida antes da entrega.</p></div>
        {loading ? <LoadingRows /> : shown.length ? <div className="search-table-wrap"><table className="data-table search-table"><thead><tr><th>Recorte</th><th>Progresso da meta</th><th>Candidatas</th><th>Processadas</th><th>Aproveitamento</th><th>Status</th><th>Ações</th></tr></thead><tbody>{shown.map((search) => <tr key={search.id} onClick={() => navigate('review', search.id)}><td><div className="company-cell"><span>{search.uf}</span><div><strong>{search.city || `Todo ${search.uf}`}</strong><small>{search.cnaes.join(', ')}</small></div></div></td><td><div className="table-progress"><div><strong>{search.totalValidLeads}</strong><span> / {targetLabelOf(search)} {isMaxTarget(search) ? 'possíveis' : 'leads'}</span><small>{searchProgressNote(search)}</small></div><ProgressBar value={progressValueOf(search)} /></div></td><td>{candidateCountOf(search)}</td><td>{search.totalProcessed}</td><td><strong>{formatNumber(search.yieldRate ?? yieldOf(search), 1)}%</strong></td><td><StatusBadge status={search.status} /></td><td onClick={(event) => event.stopPropagation()}><SearchActions search={search} busy={actionId === search.id} onOpen={() => navigate('review', search.id)} onPause={() => void pauseSearch(search)} onResume={() => void resumeSearch(search)} onDelete={() => void removeSearch(search)} /></td></tr>)}</tbody></table></div> : <EmptyState icon="⌕" title="Nenhuma busca neste estado" text="Ajuste o filtro ou crie um novo recorte." />}
      </section>
    </>
  );
}

function ReviewPage({ searchId, navigate, onSearchUpdate, onSearchDelete }: {
  searchId: string;
  navigate: (view: View, searchId?: string, resultId?: string) => void;
  onSearchUpdate: (search: LeadSearch) => void;
  onSearchDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState<LeadSearch>();
  const [results, setResults] = useState<LeadSearchResult[]>([]);
  const [status, setStatus] = useState('valid');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [runningAction, setRunningAction] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [nextSearch, nextResults] = await Promise.all([
        getLeadSearch(searchId),
        listLeadSearchResults(searchId, { page, pageSize: 20, status: status === 'all' ? undefined : status }),
      ]);
      setSearch(nextSearch); setResults(nextResults.items); setTotal(nextResults.total); setError(undefined); onSearchUpdate(nextSearch);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { if (!quiet) setLoading(false); }
  }, [onSearchUpdate, page, searchId, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!search || !isActive(search.status)) return;
    const timer = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(timer);
  }, [load, search]);

  async function toggle(result: LeadSearchResult) {
    try {
      const updated = await updateLeadSearchResultSelection(searchId, result.id, !result.selected);
      setResults((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function resumeSearch() {
    setRunningAction(true); setError(undefined);
    try { const updated = await resumeLeadSearch(searchId); setSearch(updated); onSearchUpdate(updated); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setRunningAction(false); }
  }

  async function pauseSearch() {
    setRunningAction(true); setError(undefined);
    try { const updated = await pauseLeadSearch(searchId); setSearch(updated); onSearchUpdate(updated); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setRunningAction(false); }
  }

  async function deleteSearch() {
    if (!window.confirm('Excluir esta busca e todos os resultados salvos? Esta ação não pode ser desfeita.')) return;
    setRunningAction(true); setError(undefined);
    try { await deleteLeadSearch(searchId); onSearchDelete(searchId); navigate('searches'); }
    catch (cause) { setError(errorMessage(cause)); setRunningAction(false); }
  }

  async function reprocessSearch() {
    setRunningAction(true); setError(undefined);
    try { const replacement = await reprocessLeadSearch(searchId); onSearchUpdate(replacement); navigate('review', replacement.id); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setRunningAction(false); }
  }

  if (loading && !search) return <PageLoader label="Carregando busca e resultados…" />;
  if (!search) return <Notice tone="error">{error || 'Busca não encontrada.'}</Notice>;
  const remaining = remainingQuantityOf(search);

  return (
    <>
      <section className="review-hero">
        <div className="review-title"><button className="back-button" onClick={() => navigate('searches')}>←</button><div><span className="eyebrow">Revisão de Leads</span><h1>{search.city || `Todo o estado de ${search.uf}`} <StatusBadge status={search.status} /></h1><p>{search.uf} · CNAEs {search.cnaes.join(', ')} · criada {formatDate(search.createdAt)}</p></div></div>
        <div className="heading-buttons">
          <button className="button secondary" onClick={() => void load()}>↻ Atualizar</button>
          {isActive(search.status) && <button className="button secondary" disabled={runningAction} onClick={() => void pauseSearch()}>Pausar</button>}
          {(statusKey(search.status) === 'paused' || statusKey(search.status) === 'blocked') && <button className="button primary" disabled={runningAction} onClick={() => void resumeSearch()}>{statusKey(search.status) === 'blocked' ? 'Testar e retomar' : 'Retomar'}</button>}
          {!isActive(search.status) && statusKey(search.status) !== 'paused' && statusKey(search.status) !== 'blocked' ? <button className="button secondary" disabled={runningAction} onClick={() => void reprocessSearch()}>Reprocessar</button> : null}
          <button className="button secondary danger" disabled={runningAction} onClick={() => void deleteSearch()}>Excluir</button>
          <button className="button primary" onClick={() => navigate('exports', search.id)}>Exportar leads ⇩</button>
        </div>
      </section>
      {error && <Notice tone="error" onClose={() => setError(undefined)}>{error}</Notice>}
      {statusKey(search.status) === 'blocked' && <Notice tone="error"><strong>Busca interrompida para proteger a qualidade.</strong> {search.errorMessage || 'A sessão do LinkedIn precisa ser testada antes de continuar.'}</Notice>}
      {statusKey(search.status) === 'paused' && <Notice tone="info"><strong>Busca pausada.</strong> Nenhuma nova empresa será consumida até você retomar.</Notice>}
      <section className="progress-hero panel">
        <div className="goal-progress"><div className="goal-number"><strong>{search.totalValidLeads}</strong><span>de {targetLabelOf(search)}</span></div><div><h2>contatos válidos encontrados</h2><p>{reviewProgressCopy(search, remaining)}</p><ProgressBar value={progressValueOf(search)} /></div></div>
        <div className="progress-metrics"><MiniMetric label="Candidatas encontradas" value={candidateCountOf(search)} /><MiniMetric label="Empresas processadas" value={search.totalProcessed} /><MiniMetric label="Leads válidos" value={search.totalValidLeads} accent /><MiniMetric label="Aproveitamento" value={`${formatNumber(search.yieldRate ?? yieldOf(search), 1)}%`} /></div>
        {isActive(search.status) && <div className="live-line"><span className="pulse" /> Enriquecimento em andamento. Resultados parciais são salvos automaticamente.</div>}
        {poolExhausted(search) && <div className="live-line warning"><span>!</span> {poolExhaustionMessage(search, remaining)}</div>}
      </section>

      <section className="panel table-panel">
        <div className="result-head"><div><span className="eyebrow">Resultados parciais</span><h2>Leads da busca</h2></div><div className="segmented"><button className={status === 'valid' ? 'active' : ''} onClick={() => { setStatus('valid'); setPage(1); }}>Válidos</button><button className={status === 'rejected' ? 'active' : ''} onClick={() => { setStatus('rejected'); setPage(1); }}>Rejeitados</button><button className={status === 'error' ? 'active' : ''} onClick={() => { setStatus('error'); setPage(1); }}>Com erro</button><button className={status === 'all' ? 'active' : ''} onClick={() => { setStatus('all'); setPage(1); }}>Todos</button></div></div>
        {loading ? <LoadingRows /> : results.length ? (
          <div className="results-wrap"><table className="data-table results-table"><thead><tr><th><span className="sr-only">Selecionar</span></th><th>Empresa</th><th>Sócio × decisor</th><th>Contato final</th><th>Score</th><th>Status</th><th /></tr></thead><tbody>{results.map((result) => {
            const lead = leadOf(result); const decision = lead?.decisionMaker ?? lead?.bestDecisionMaker;
            return <tr key={result.id} onClick={() => navigate('detail', searchId, result.id)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={result.selected} disabled={statusKey(result.status) !== 'valid'} onChange={() => void toggle(result)} aria-label={`Selecionar ${companyNameOf(result)}`} /></td><td><div className="company-cell"><span>{initials(companyNameOf(result))}</span><div><strong>{companyNameOf(result)}</strong><small>{formatCnpj(result.cnpj)} · {locationOf(result)}</small></div></div></td><td><div className="match-cell"><strong>{partnerOf(result) || 'Sócio não informado'}</strong><span className={decisionMatched(result) ? 'match-link matched' : 'match-link'}>{decisionMatched(result) ? '↔ match validado' : '↔ sem match'}</span><small>{decision?.name || 'Decisor não encontrado'}</small></div></td><td><div className="contact-cell"><strong>{result.finalEmail || lead?.finalEmail || 'Sem e-mail'}</strong><small>{result.finalPhone || lead?.finalPhone || 'Sem telefone'}</small></div></td><td><ScoreBadge score={result.finalScore ?? 0} /></td><td><ResultBadge status={result.status} /></td><td><button className="row-action" aria-label="Ver detalhes">›</button></td></tr>;
          })}</tbody></table></div>
        ) : <EmptyState icon={status === 'valid' ? '⌛' : '⌕'} title={isActive(search.status) && status === 'valid' ? 'Os primeiros leads estão a caminho' : 'Nenhum resultado neste filtro'} text={isActive(search.status) ? 'A tela atualiza automaticamente enquanto o job processa candidatas.' : 'Os resultados salvos da busca não possuem itens nesta categoria.'} />}
        <Pagination page={page} pageSize={20} total={total} onChange={setPage} />
      </section>
    </>
  );
}

function LeadDetailPage({ searchId, resultId, navigate }: { searchId: string; resultId: string; navigate: (view: View, searchId?: string, resultId?: string) => void }) {
  const [result, setResult] = useState<LeadSearchResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => { setLoading(true); getLeadSearchResult(searchId, resultId).then(setResult).catch((cause) => setError(errorMessage(cause))).finally(() => setLoading(false)); }, [resultId, searchId]);
  if (loading) return <PageLoader label="Abrindo evidências do lead…" />;
  if (!result) return <Notice tone="error">{error || 'Lead não encontrado.'}</Notice>;
  const lead = leadOf(result); const decision = lead?.decisionMaker ?? lead?.bestDecisionMaker;
  const evidence = lead?.evidence ?? [];
  return (
    <>
      <section className="detail-heading"><button className="back-button" onClick={() => navigate('review', searchId)}>←</button><div className="detail-company-avatar">{initials(companyNameOf(result))}</div><div><span className="eyebrow">Detalhes do Lead</span><h1>{companyNameOf(result)}</h1><p>{formatCnpj(result.cnpj)} · {locationOf(result)} · CNAE {result.cnae || result.candidate?.cnae || lead?.cnae || '—'}</p></div><div className="detail-status"><ResultBadge status={result.status} /><ScoreBadge score={result.finalScore ?? lead?.finalScore ?? lead?.score ?? 0} large /></div></section>
      <section className="detail-grid">
        <div className="detail-main">
          <section className="panel detail-card"><PanelHeader eyebrow="Fonte local" title="Dados da Receita Federal" /><div className="definition-grid"><Definition label="Razão social" value={result.candidate?.legalName || lead?.companyName} /><Definition label="Nome fantasia" value={result.candidate?.tradingName || lead?.tradingName} /><Definition label="Cidade / UF" value={locationOf(result)} /><Definition label="CNAE principal" value={result.cnae || result.candidate?.cnae || lead?.cnae} /><Definition label="Sócios considerados" value={(lead?.partners || result.candidate?.partners || []).join(', ')} wide /></div></section>
          <section className="panel detail-card"><PanelHeader eyebrow="Cross-match" title="Sócio da Receita × decisor do LinkedIn" action={<MatchPill matched={decisionMatched(result)} />} /><div className="match-compare"><PersonBox label="Sócio na Receita" name={lead?.decisionMakerMatch?.partnerName || partnerOf(result) || 'Não informado'} detail="Quadro societário local" /><span className={decisionMatched(result) ? 'compare-arrow active' : 'compare-arrow'}>⇄</span><PersonBox label="Decisor no LinkedIn" name={decision?.name || 'Não encontrado'} detail={`${decision?.title || decision?.role || 'Sem cargo disponível'} · ${decision?.associationVerified ? 'vínculo atual confirmado' : 'vínculo não confirmado'}`} linkedin={decision?.linkedin_url || decision?.linkedinUrl} /></div><div className="match-explanation"><strong>{lead?.decisionMakerMatch?.confidence ?? 0}% de confiança no match</strong><p>{lead?.decisionMakerMatch?.explanation || 'A comparação usa normalização de nomes e sinais retornados pelo enriquecimento.'}</p></div></section>
          <section className="panel detail-card"><PanelHeader eyebrow="Auditoria" title="Explicações e evidências" /><div className="evidence-list">{evidence.length ? evidence.map((item, index) => <EvidenceRow item={item} key={index} />) : <p className="muted-copy">Nenhuma evidência estruturada foi salva para este resultado.</p>}</div>{result.rejectionReasons?.length ? <div className="rejection-box"><strong>Motivos de rejeição</strong>{result.rejectionReasons.map((reason) => <p key={reason}>{reason}</p>)}</div> : null}</section>
        </div>
        <aside className="detail-side">
          <section className="panel contact-card"><span className="eyebrow">Contato escolhido</span><h2>Canal final de abordagem</h2><ContactItem icon="@" label="E-mail validado" value={result.finalEmail || lead?.finalEmail} meta={lead?.emailCorporate ? 'Corporativo' : lead?.emailGeneric ? 'Genérico' : undefined} /><ContactItem icon="☎" label="Telefone validado" value={result.finalPhone || lead?.finalPhone} meta={lead?.phoneMobile ? 'Celular' : undefined} /><small className="validation-note">“Validado” significa que o contato passou pelas regras técnicas deste MVP.</small></section>
          <section className="panel link-card"><span className="eyebrow">Company Page</span><h3>{companyNameOf(result)}</h3><p>{lead?.companyWebsite || result.candidate?.website || 'Site corporativo não identificado'}</p>{(lead?.companyLinkedinUrl || lead?.linkedinCompanyUrl || lead?.linkedinUrl) ? <a className="button linkedin full" href={lead.companyLinkedinUrl || lead.linkedinCompanyUrl || lead.linkedinUrl} target="_blank" rel="noreferrer">in Abrir no LinkedIn ↗</a> : <span className="button disabled full">Company Page indisponível</span>}</section>
          {lead?.isDemoEvidence ? <section className="panel warning-card"><strong>Evidência demonstrativa</strong><p>Este resultado usa sinais demo e não deve ser tratado como contato real.</p></section> : null}
          {lead?.warnings?.length ? <section className="panel warning-card"><strong>Pontos de atenção</strong>{lead.warnings.map((warning) => <p key={warning}>! {warning}</p>)}</section> : null}
        </aside>
      </section>
    </>
  );
}

function ExportsPage({ searches, initialSearchId, navigate }: { searches: LeadSearch[]; initialSearchId?: string; navigate: (view: View, searchId?: string, resultId?: string) => void }) {
  const [searchId, setSearchId] = useState(initialSearchId || searches[0]?.id || '');
  const [selectedOnly, setSelectedOnly] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (!searchId && searches[0]) setSearchId(searches[0].id); }, [searchId, searches]);
  const selected = searches.find((item) => item.id === searchId);
  async function download() {
    if (!searchId) return;
    setDownloading(true); setError(undefined);
    try { const file = await exportLeadSearch(searchId, selectedOnly); triggerDownload(file.blob, file.filename); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setDownloading(false); }
  }
  return (
    <>
      <section className="page-heading"><span className="eyebrow">Exportações</span><h1>Leads finais, prontos para o seu fluxo comercial.</h1><p>A exportação usa os resultados válidos persistidos na busca — nunca a lista bruta de CNPJs candidatos.</p></section>
      <section className="export-layout">
        <div className="panel export-builder"><SectionTitle number="01" title="Escolha a busca" text="Buscas em andamento também permitem exportar os resultados parciais já validados." /><label className="field"><span>Busca de origem</span><select value={searchId} onChange={(event) => setSearchId(event.target.value)}><option value="">Selecione uma busca</option>{searches.map((search) => <option value={search.id} key={search.id}>{search.city || `Todo ${search.uf}`} · {search.cnaes.join(', ')} · {search.totalValidLeads} válidos</option>)}</select></label>{selected && <div className="export-search-summary"><div><span className="search-symbol">{selected.uf}</span><div><strong>{selected.city || `Todo o estado de ${selected.uf}`}</strong><small>{selected.cnaes.join(' · ')}</small></div></div><StatusBadge status={selected.status} /></div>}
          <SectionTitle number="02" title="Defina o recorte da exportação" text="Resultados rejeitados nunca entram no arquivo final." /><div className="radio-stack"><label className={selectedOnly ? 'radio-card active' : 'radio-card'}><input type="radio" checked={selectedOnly} onChange={() => setSelectedOnly(true)} /><span><strong>Somente leads selecionados</strong><small>Respeita a curadoria feita na Revisão de Leads.</small></span></label><label className={!selectedOnly ? 'radio-card active' : 'radio-card'}><input type="radio" checked={!selectedOnly} onChange={() => setSelectedOnly(false)} /><span><strong>Todos os leads válidos</strong><small>Inclui cada resultado que passou pelos filtros da busca.</small></span></label></div>
          {error && <Notice tone="error">{error}</Notice>}<button className="button primary large full" disabled={!searchId || downloading} onClick={() => void download()}>{downloading ? 'Preparando CSV…' : 'Baixar arquivo CSV'} <span>⇩</span></button>
        </div>
        <aside className="panel export-preview"><span className="eyebrow">Conteúdo do arquivo</span><h2>{selected?.totalValidLeads ?? 0} leads disponíveis</h2><p>O backend consulta a busca e gera o CSV no momento do download.</p><div className="csv-preview"><span>CNPJ</span><span>Empresa</span><span>Cidade / UF</span><span>CNAE</span><span>Sócio</span><span>Decisor</span><span>E-mail final</span><span>Telefone final</span><span>Score</span><span>Evidências</span></div><div className="privacy-note"><strong>Uso responsável</strong><p>Revise finalidade, base legal, retenção e direitos dos titulares antes de ativar uma campanha.</p></div>{selected && <button className="text-button" onClick={() => navigate('review', selected.id)}>Voltar para a revisão →</button>}</aside>
      </section>
    </>
  );
}

function MetricCard({ label, value, detail, tone, icon }: { label: string; value: string | number; detail: string; tone: string; icon: string }) { return <article className={`metric-card ${tone}`}><span className="metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>; }
function SearchActions({ search, busy, onOpen, onPause, onResume, onDelete }: { search: LeadSearch; busy: boolean; onOpen: () => void; onPause: () => void; onResume: () => void; onDelete: () => void }) {
  const key = statusKey(search.status);
  return (
    <div className="search-actions">
      <button className="row-action" disabled={busy} onClick={onOpen} aria-label="Abrir busca">›</button>
      {isActive(search.status) && <button className="mini-action" disabled={busy} onClick={onPause}>Pausar</button>}
      {(key === 'paused' || key === 'blocked') && <button className="mini-action primary" disabled={busy} onClick={onResume}>Retomar</button>}
      <button className="mini-action danger" disabled={busy} onClick={onDelete}>Excluir</button>
    </div>
  );
}
function MiniMetric({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) { return <div className={accent ? 'mini-stat accent' : 'mini-stat'}><span>{label}</span><strong>{value}</strong></div>; }
function PanelHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) { return <div className="panel-header"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action}</div>; }
function SectionTitle({ number, title, text }: { number: string; title: string; text: string }) { return <div className="section-title"><span>{number}</span><div><h2>{title}</h2><p>{text}</p></div></div>; }
function CheckCard({ checked, onChange, disabled = false, icon, title, text }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; icon: string; title: string; text: string }) { return <label className={`${checked ? 'check-card active' : 'check-card'}${disabled ? ' disabled' : ''}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className="check-icon">{icon}</span><span><strong>{title}</strong><small>{text}</small></span><i /></label>; }
function Toggle({ checked, onChange, label, info, infoPlacement = 'left' }: { checked: boolean; onChange: (value: boolean) => void; label: string; info?: string; infoPlacement?: 'left' | 'right' }) { return <label className="toggle-row"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /><span>{label}</span>{info && <InfoHint text={info} placement={infoPlacement} />}</label>; }
function InfoHint({ text, placement = 'left' }: { text: string; placement?: 'left' | 'right' }) { return <span className={`info-hint ${placement}`} tabIndex={0} aria-label={text} data-tooltip={text} onClick={(event) => event.preventDefault()}>i</span>; }
function Criteria({ active, text }: { active: boolean; text: string }) { return <div className={active ? 'criteria active' : 'criteria'}><span>{active ? '✓' : '—'}</span>{text}</div>; }
function ProgressBar({ value }: { value: number }) { return <span className="progress-bar"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>; }
function StatusBadge({ status }: { status: string }) { const key = statusKey(status); const labels: Record<string, string> = { queued: 'Na fila', pending: 'Na fila', processing: 'Em andamento', running: 'Em andamento', paused: 'Pausada', blocked: 'LinkedIn bloqueado', completed: 'Concluída', exhausted: 'Candidatas esgotadas', failed: 'Falhou', cancelled: 'Cancelada' }; return <span className={`status-badge ${key}`}><i />{labels[key] || status}</span>; }
function ResultBadge({ status }: { status: string }) { const key = statusKey(status); const labels: Record<string, string> = { valid: 'Válido', rejected: 'Rejeitado', error: 'Erro', processing: 'Processando', pending: 'Pendente' }; return <span className={`result-badge ${key}`}>{labels[key] || status}</span>; }
function ScoreBadge({ score, large = false }: { score: number; large?: boolean }) { const tone = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low'; return <span className={`${large ? 'score-badge large' : 'score-badge'} ${tone}`}><strong>{Math.round(score)}</strong><small>/100</small></span>; }
function MatchPill({ matched }: { matched: boolean }) { return <span className={matched ? 'match-pill matched' : 'match-pill'}>{matched ? '✓ Match validado' : 'Sem correspondência'}</span>; }
function FunnelLine({ label, value, width, accent = false }: { label: string; value: string | number; width: string; accent?: boolean }) { return <div className={accent ? 'funnel-line accent' : 'funnel-line'} style={{ width }}><span>{label}</span><strong>{value}</strong></div>; }
function Definition({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) { return <div className={wide ? 'definition wide' : 'definition'}><span>{label}</span><strong>{value || '—'}</strong></div>; }
function PersonBox({ label, name, detail, linkedin }: { label: string; name: string; detail: string; linkedin?: string }) { return <div className="person-box"><span>{label}</span><div className="person-avatar">{initials(name)}</div><strong>{name}</strong><small>{detail}</small>{linkedin && <a href={linkedin} target="_blank" rel="noreferrer">Ver perfil ↗</a>}</div>; }
function ContactItem({ icon, label, value, meta }: { icon: string; label: string; value?: string; meta?: string }) { return <div className={value ? 'contact-item' : 'contact-item empty'}><span>{icon}</span><div><small>{label}</small><strong>{value || 'Não disponível'}</strong>{meta && <em>{meta}</em>}</div></div>; }
function EvidenceRow({ item }: { item: string | EvidenceItem }) { const evidence = typeof item === 'string' ? undefined : item; const text = typeof item === 'string' ? item : item.detail || item.value || item.label || 'Evidência registrada'; return <div className="evidence-row"><span>✓</span><div><strong>{text}</strong>{evidence?.source && <small>Fonte: {evidence.source}{evidence.confidence ? ` · ${evidence.confidence}%` : ''}</small>}</div></div>; }
function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) { const pages = Math.max(1, Math.ceil(total / pageSize)); if (total <= pageSize) return <div className="table-footer">Mostrando {total} resultado{total === 1 ? '' : 's'}</div>; return <div className="table-footer"><span>{total} resultados</span><div><button disabled={page <= 1} onClick={() => onChange(page - 1)}>← Anterior</button><strong>{page} / {pages}</strong><button disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima →</button></div></div>; }
function Notice({ children, tone, onClose }: { children: ReactNode; tone: 'error' | 'info'; onClose?: () => void }) { return <div className={`notice ${tone}`}><span>{tone === 'error' ? '!' : 'i'}</span><div>{children}</div>{onClose && <button onClick={onClose}>×</button>}</div>; }
function EmptyState({ icon, title, text, action }: { icon: string; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{text}</p>{action}</div>; }
function LoadingRows() { return <div className="loading-rows"><i /><i /><i /><i /></div>; }
function PageLoader({ label }: { label: string }) { return <div className="page-loader"><span /><strong>{label}</strong></div>; }
function ContextEmpty({ navigate }: { navigate: (view: View, searchId?: string, resultId?: string) => void }) { return <section className="panel context-empty"><EmptyState icon="⌕" title="Escolha uma busca primeiro" text="Abra uma busca para revisar resultados e evidências." action={<button className="button primary" onClick={() => navigate('searches')}>Ver buscas</button>} /></section>; }

function readRoute(): RouteState {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'searches' && parts[1] === 'new') return { view: 'new-search' };
  if (parts[0] === 'searches' && parts[1] && parts[2] === 'results' && parts[3]) return { view: 'detail', searchId: parts[1], resultId: parts[3] };
  if (parts[0] === 'searches' && parts[1]) return { view: 'review', searchId: parts[1] };
  if (parts[0] === 'searches') return { view: 'searches' };
  if (parts[0] === 'exports') return { view: 'exports', searchId: new URLSearchParams(window.location.search).get('search') || undefined };
  return { view: 'dashboard' };
}
function routePath(route: RouteState): string { if (route.view === 'new-search') return '/searches/new'; if (route.view === 'searches') return '/searches'; if (route.view === 'review' && route.searchId) return `/searches/${route.searchId}`; if (route.view === 'detail' && route.searchId && route.resultId) return `/searches/${route.searchId}/results/${route.resultId}`; if (route.view === 'exports') return `/exports${route.searchId ? `?search=${encodeURIComponent(route.searchId)}` : ''}`; return '/app'; }
function pageTitle(view: View): string { return NAV_ITEMS.find((item) => item.view === view)?.label || 'Dashboard'; }
function parseCnaes(value: string): string[] { return [...new Set(value.split(/[\s,;]+/).map((item) => item.replace(/\D/g, '')).filter((item) => item.length === 7))]; }
function emailCriteriaText(emailType: EmailTypeFilter): string { if (emailType === 'corporate') return 'E-mail corporativo'; if (emailType === 'non_corporate') return 'E-mail não corporativo'; return 'E-mail obrigatório'; }
function qualityLevelLabel(value: LeadQualityLevel | undefined): string {
  if (value === 'muito_alto') return 'Muito alto';
  if (value === 'alto') return 'Alto';
  if (value === 'medio') return 'Médio';
  return 'Baixo';
}
function qualityLevelHint(value: LeadQualityLevel): { label: string; text: string; tone: string; coverage: number } {
  if (value === 'muito_alto') return { label: 'Qualidade muito alta', text: 'Exige decisor, contato forte e match confiável; reduz volume.', tone: 'high', coverage: 96 };
  if (value === 'alto') return { label: 'Qualidade alta', text: 'Prioriza LinkedIn real, decisor ou evidência forte sem depender só de uma URL.', tone: 'good', coverage: 78 };
  if (value === 'medio') return { label: 'Qualidade média', text: 'Aceita contato válido com sinais suficientes de empresa para revisão.', tone: 'medium', coverage: 56 };
  return { label: 'Qualidade baixa', text: 'Amplia volume e exige mais revisão manual antes de exportar.', tone: 'low', coverage: 34 };
}
function qualityRuleLabels(value: LeadQualityLevel, linkedinEnabled = true): string[] {
  if (!linkedinEnabled) {
    if (value === 'alto') return ['E-mail não genérico com nome', 'Telefone tecnicamente válido', 'Site empresarial identificado'];
    if (value === 'medio') return ['Contato tecnicamente válido', 'Algum sinal local da empresa'];
    return ['Contato tecnicamente válido', 'Sem confirmação de cargo ou vínculo profissional'];
  }
  if (value === 'muito_alto') return [
    'LinkedIn e dados da empresa reais',
    'Decisor real com perfil',
    'Contato do decisor ou e-mail com nome',
    'Match muito forte',
  ];
  if (value === 'alto') return [
    'LinkedIn real',
    'Empresa, decisor ou e-mail com nome',
    'E-mail final não genérico',
  ];
  if (value === 'medio') return [
    'Contato tecnicamente válido',
    'Algum sinal de empresa',
  ];
  return [
    'Contato tecnicamente válido',
    'Dados demo bloqueados no modo real',
  ];
}
function statusKey(status: string): string { return String(status || '').toLowerCase(); }
function isActive(status: string): boolean { return ['pending', 'queued', 'running', 'processing', 'selecting_candidates', 'enriching'].includes(statusKey(status)); }
function linkedinStatusOf(value: LinkedinDiagnostic): { label: string; tone: string } {
  const state = value.sessionState || value.session_state;
  if (value.enabled === false) return { label: 'LinkedIn · Desativado', tone: 'unknown' };
  if (value.mode === 'demo' || value.runtimeMode === 'demo' || state === 'demo') return { label: 'LinkedIn · Demo', tone: 'demo' };
  if (value.ready && (value.authenticated || state === 'authenticated')) return { label: 'LinkedIn · Real conectado', tone: 'ready' };
  if (state === 'login_required' || value.errorCode === 'auth_required') return { label: 'LinkedIn · Login necessário', tone: 'error' };
  if (state === 'challenge' || value.errorCode === 'challenge') return { label: 'LinkedIn · Verificação solicitada', tone: 'warning' };
  if (state === 'not_checked' && value.ok) return { label: 'LinkedIn · Não testado', tone: 'unknown' };
  return { label: 'LinkedIn · Indisponível', tone: 'error' };
}
function formatDiagnosticDate(value: LinkedinDiagnostic): string {
  const raw = value.checkedAt || value.lastCheckedAt || value.last_checked_at;
  return raw ? formatDate(raw) : 'Ainda não testado';
}
function isMaxTarget(search: LeadSearch): boolean { return search.targetMode === 'max'; }
function poolExhausted(search: LeadSearch): boolean { return search.completionReason === 'candidate_pool_exhausted' || statusKey(search.status) === 'exhausted'; }
function targetLabelOf(search: LeadSearch): string { return isMaxTarget(search) ? 'max' : formatNumber(search.targetQuantity); }
function remainingQuantityOf(search: LeadSearch): number { return isMaxTarget(search) ? 0 : search.remainingQuantity ?? Math.max(0, search.targetQuantity - search.totalValidLeads); }
function progress(search: LeadSearch): number {
  if (isMaxTarget(search)) {
    return search.totalCandidatesFound ? Math.min(100, search.totalProcessed / search.totalCandidatesFound * 100) : poolExhausted(search) ? 100 : 0;
  }
  return search.targetQuantity ? Math.min(100, search.totalValidLeads / search.targetQuantity * 100) : 0;
}
function progressValueOf(search: LeadSearch): number { return search.progressPercent ?? progress(search); }
function searchProgressNote(search: LeadSearch): string {
  if (isMaxTarget(search)) return poolExhausted(search) ? 'Todo o recorte foi processado' : `${formatNumber(search.totalProcessed)} candidatas processadas`;
  const remaining = remainingQuantityOf(search);
  if (poolExhausted(search) && remaining > 0) return `Candidatos esgotados; faltaram ${formatNumber(remaining)}`;
  return remaining ? `Faltam ${formatNumber(remaining)}` : 'Meta atingida';
}
function reviewProgressCopy(search: LeadSearch, remaining: number): string {
  if (isMaxTarget(search)) return poolExhausted(search) ? 'Máximo possível encontrado para este recorte.' : `A busca vai processar todas as candidatas ${search.city ? 'da cidade' : 'do estado'}.`;
  if (poolExhausted(search) && remaining > 0) return `Busca concluída com candidatos esgotados; faltaram ${formatNumber(remaining)} para a meta.`;
  return remaining ? `Faltam ${formatNumber(remaining)} para atingir a meta` : 'Meta atingida — a busca foi concluída';
}
function poolExhaustionMessage(search: LeadSearch, remaining: number): string {
  if (isMaxTarget(search)) return `Busca concluída: todos os candidatos do recorte foram processados e ${formatNumber(search.totalValidLeads)} leads válidos ficaram disponíveis.`;
  return `Busca concluída, mas não retornou a quantidade pedida porque os candidatos acabaram. Foram encontrados ${formatNumber(search.totalValidLeads)} leads válidos e faltaram ${formatNumber(remaining)}.`;
}
function yieldOf(search: LeadSearch): number { return search.totalProcessed ? search.totalValidLeads / search.totalProcessed * 100 : 0; }
function candidateCountOf(search: LeadSearch): string { return search.candidateCountStatus === 'lower_bound' ? search.totalCandidatesFound ? `≥ ${formatNumber(search.totalCandidatesFound)}` : 'Carregando…' : formatNumber(search.totalCandidatesFound); }
function leadOf(result: LeadSearchResult): LeadCrossMatchSnapshot | undefined { return result.lead || result.leadCrossMatch; }
function companyNameOf(result: LeadSearchResult): string { const lead = leadOf(result); return result.companyName || lead?.companyName || result.candidate?.tradingName || result.candidate?.legalName || 'Empresa sem nome'; }
function locationOf(result: LeadSearchResult): string { const lead = leadOf(result); return [result.city || result.candidate?.city || lead?.city, result.uf || result.candidate?.uf || lead?.uf].filter(Boolean).join('/') || 'Local não informado'; }
function partnerOf(result: LeadSearchResult): string | undefined { const lead = leadOf(result); return result.partner || lead?.decisionMakerMatch?.partnerName || lead?.partnerName || lead?.socio || lead?.partners?.[0] || result.candidate?.partners?.[0]; }
function decisionMatched(result: LeadSearchResult): boolean { const lead = leadOf(result); return Boolean(result.decisionMakerMatched ?? lead?.decisionMakerMatched ?? lead?.decisionMakerMatch?.matched ?? lead?.decisionMaker?.matchedPartner); }
function formatCnpj(value: string): string { const digits = value.replace(/\D/g, ''); return digits.length === 14 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : value; }
function initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'SB'; }
function formatNumber(value: number, digits = 0): string { return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function formatRelative(value: string): string { const diff = Date.now() - new Date(value).getTime(); if (!Number.isFinite(diff)) return value; const minutes = Math.max(1, Math.floor(diff / 60000)); if (minutes < 60) return `há ${minutes} min`; const hours = Math.floor(minutes / 60); if (hours < 24) return `há ${hours} h`; return `há ${Math.floor(hours / 24)} d`; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function triggerDownload(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }

export default ProductApp;
