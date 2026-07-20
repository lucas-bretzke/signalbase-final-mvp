import { CSSProperties, MouseEvent, useEffect, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { MarketingIcon, MarketingIconName } from './MarketingIcon';
import './marketing.css';
import './marketing-sections.css';
import './marketing-end.css';

const sources: Array<{ icon: MarketingIconName; label: string; detail: string }> = [
  { icon: 'database', label: 'Dados governamentais', detail: 'Cadastro, CNAE e quadro societário' },
  { icon: 'linkedin', label: 'LinkedIn', detail: 'Sinais profissionais disponíveis' },
  { icon: 'globe', label: 'Sites corporativos', detail: 'Domínio, contexto e canais oficiais' },
  { icon: 'shield', label: 'Regras de qualidade', detail: 'Score, filtros e rastreabilidade' },
];

const workflowSteps = [
  {
    number: '01',
    title: 'Desenhe seu mercado',
    text: 'Combine UF, cidade, CNAEs e volume desejado para transformar seu ICP em um recorte objetivo.',
    caption: 'Filtros de mercado',
  },
  {
    number: '02',
    title: 'Defina o que é um lead bom',
    text: 'Escolha qualidade mínima, contato corporativo, celular e a exigência de correspondência entre sócio e decisor.',
    caption: 'Critérios de aceite',
  },
  {
    number: '03',
    title: 'Deixe o motor cruzar os sinais',
    text: 'A EconoSense avalia empresas, reúne evidências e elimina resultados que não passam pelas suas regras.',
    caption: 'Investigação multifuente',
  },
  {
    number: '04',
    title: 'Revise antes de exportar',
    text: 'Abra score, fontes, alertas e motivos de rejeição. Selecione o que faz sentido e leve ao seu CRM em CSV.',
    caption: 'Decisão humana',
  },
];

const plans = [
  {
    name: 'Essencial',
    monthly: 297,
    annual: 247,
    volume: '300 leads aprovados / mês',
    description: 'Para fundadores e operações que estão validando seu primeiro canal outbound.',
    features: ['1 usuário', 'Filtros por região e CNAE', 'Score, fontes e evidências', 'Revisão e exportação CSV'],
    cta: 'Começar no Essencial',
  },
  {
    name: 'Growth',
    monthly: 697,
    annual: 580,
    volume: '1.000 leads aprovados / mês',
    description: 'Para times e agências que precisam manter o pipeline abastecido sem baixar o padrão.',
    features: ['Até 5 usuários', 'Todos os filtros avançados', 'Buscas e critérios salvos', 'Prioridade de processamento', 'Rollover de até 2 mensalidades'],
    cta: 'Escolher Growth',
    featured: true,
  },
  {
    name: 'Scale',
    monthly: 1697,
    annual: 1414,
    volume: '3.500 leads aprovados / mês',
    description: 'Para operações com múltiplos mercados, clientes ou squads comerciais.',
    features: ['Até 10 usuários', 'Grandes exportações', 'Processamento prioritário', 'Onboarding assistido', 'Suporte com prioridade'],
    cta: 'Escalar operação',
  },
];

const faqs = [
  {
    question: 'Posso testar antes de contratar?',
    answer: 'Sim. A proposta é liberar 10 leads aprovados para você conhecer os filtros, abrir as evidências e validar o fluxo sem cadastrar cartão.',
  },
  {
    question: 'O que significa “lead aprovado”?',
    answer: 'É um resultado que passou pela qualidade mínima e pelas regras que você configurou. A validação de e-mail e telefone é técnica; não equivale a garantia de entregabilidade, titularidade ou consentimento.',
  },
  {
    question: 'De onde vêm os dados?',
    answer: 'A EconoSense combina dados cadastrais públicos, presença corporativa na web e sinais profissionais disponíveis em fontes como o LinkedIn, sempre conforme disponibilidade, permissões e termos aplicáveis.',
  },
  {
    question: 'Resultados rejeitados consomem minha franquia?',
    answer: 'A lógica comercial proposta é cobrar somente pelos leads aprovados e revelados para exportação. Empresas avaliadas e rejeitadas pelos seus critérios não entram na franquia.',
  },
  {
    question: 'A EconoSense garante conformidade com a LGPD?',
    answer: 'A plataforma oferece rastreabilidade, critérios transparentes e controles para apoiar um uso responsável. A adequação também depende da finalidade, base legal, retenção e abordagem definidas por cada organização.',
  },
  {
    question: 'Consigo usar os contatos no meu CRM?',
    answer: 'Sim. Você revisa e seleciona os resultados antes de exportar um CSV estruturado, pronto para ser organizado no seu fluxo comercial.',
  },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerSolid, setHeaderSolid] = useState(false);
  const [annual, setAnnual] = useState(true);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const updateHeader = () => setHeaderSolid(window.scrollY > 28);
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible');
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('[data-reveal]').forEach((node) => observer.observe(node));

    return () => {
      window.removeEventListener('scroll', updateHeader);
      observer.disconnect();
    };
  }, []);

  function tilt(event: MouseEvent<HTMLDivElement>) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    event.currentTarget.style.setProperty('--tilt-x', `${y * -7}deg`);
    event.currentTarget.style.setProperty('--tilt-y', `${x * 9}deg`);
    event.currentTarget.style.setProperty('--spot-x', `${(x + 0.5) * 100}%`);
    event.currentTarget.style.setProperty('--spot-y', `${(y + 0.5) * 100}%`);
  }

  function resetTilt(event: MouseEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty('--tilt-x', '0deg');
    event.currentTarget.style.setProperty('--tilt-y', '0deg');
  }

  return (
    <div className="marketing-page">
      <div className="marketing-noise" aria-hidden="true" />
      <div className="announcement">
        <span><i /> NOVA GERAÇÃO ECONOSENSE</span>
        <strong>Inteligência multifuente com evidências por lead</strong>
        <a href="#qualidade">Conhecer o motor <MarketingIcon name="arrow" size={15} /></a>
      </div>

      <header className={`marketing-header ${headerSolid ? 'solid' : ''}`}>
        <a className="marketing-logo-link" href="#inicio" aria-label="EconoSense — início">
          <BrandLogo inverse />
        </a>
        <nav id="marketing-navigation" className={menuOpen ? 'marketing-nav open' : 'marketing-nav'} aria-label="Navegação principal">
          <a href="#produto" onClick={() => setMenuOpen(false)}>Produto</a>
          <a href="#qualidade" onClick={() => setMenuOpen(false)}>Motor de qualidade</a>
          <a href="#como-funciona" onClick={() => setMenuOpen(false)}>Como funciona</a>
          <a href="#para-quem" onClick={() => setMenuOpen(false)}>Para quem</a>
          <a href="#precos" onClick={() => setMenuOpen(false)}>Preços</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
        </nav>
        <div className="marketing-header-actions">
          <a className="header-login" href="/login">Entrar</a>
          <a className="marketing-button small" href="/cadastro">Criar busca grátis <MarketingIcon name="arrow" size={16} /></a>
          <button className="menu-toggle" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menuOpen} aria-controls="marketing-navigation">
            <MarketingIcon name={menuOpen ? 'close' : 'menu'} size={22} />
          </button>
        </div>
      </header>

      <main>
        <section className="hero-section" id="inicio">
          <div className="hero-grid-lines" aria-hidden="true" />
          <div className="hero-aurora one" aria-hidden="true" />
          <div className="hero-aurora two" aria-hidden="true" />
          <div className="marketing-container hero-layout">
            <div className="hero-copy" data-reveal>
              <span className="hero-eyebrow"><MarketingIcon name="spark" size={16} /> PROSPECÇÃO B2B COM INTELIGÊNCIA EXPLICÁVEL</span>
              <h1>Encontre quem decide.<br /><em>Entenda por que confiar.</em></h1>
              <p>A EconoSense cruza dados cadastrais do governo, sinais profissionais do LinkedIn, sites corporativos e regras de qualidade para transformar seu ICP em contatos B2B com contexto.</p>
              <div className="hero-actions">
                <a className="marketing-button hero-primary" href="/cadastro">Criar minha primeira busca <MarketingIcon name="arrow" /></a>
                <a className="marketing-button ghost" href="#qualidade"><span className="play-dot">▶</span> Ver o motor em ação</a>
              </div>
              <div className="hero-assurances">
                <span><MarketingIcon name="check" size={15} /> 10 leads para testar</span>
                <span><MarketingIcon name="check" size={15} /> Sem cartão</span>
                <span><MarketingIcon name="check" size={15} /> Revise antes de exportar</span>
              </div>
            </div>

            <div className="signal-stage-wrap" data-reveal>
              <div className="signal-stage" onMouseMove={tilt} onMouseLeave={resetTilt}>
                <div className="stage-spotlight" aria-hidden="true" />
                <div className="orbit orbit-one" aria-hidden="true" />
                <div className="orbit orbit-two" aria-hidden="true" />
                <div className="data-core" aria-hidden="true">
                  <div className="core-glow" />
                  <div className="core-bar bar-1" />
                  <div className="core-bar bar-2" />
                  <div className="core-bar bar-3" />
                  <div className="core-bar bar-4" />
                  <div className="core-bar bar-5" />
                  <span>ECONOSENSE ENGINE</span>
                </div>

                <div className="floating-panel source-panel government">
                  <span className="panel-icon cyan"><MarketingIcon name="database" size={18} /></span>
                  <div><small>FONTE 01</small><strong>Dados cadastrais</strong><em>CNPJ • CNAE • Sócios</em></div>
                  <i className="live-pulse" />
                </div>
                <div className="floating-panel source-panel professional">
                  <span className="panel-icon blue"><MarketingIcon name="linkedin" size={18} /></span>
                  <div><small>FONTE 02</small><strong>Sinais profissionais</strong><em>Empresa • Cargo • Perfil</em></div>
                  <i className="live-pulse" />
                </div>
                <div className="floating-panel source-panel web-source">
                  <span className="panel-icon violet"><MarketingIcon name="globe" size={18} /></span>
                  <div><small>FONTE 03</small><strong>Presença corporativa</strong><em>Site • Domínio • Contato</em></div>
                </div>

                <div className="floating-panel lead-panel">
                  <div className="lead-panel-head">
                    <span className="lead-avatar">MC</span>
                    <div><small>EXEMPLO DE INTERFACE</small><strong>Marina Costa</strong><em>Diretora Comercial • Novera</em></div>
                    <span className="confidence-orb"><b>92</b><small>/100</small></span>
                  </div>
                  <div className="match-line"><span><MarketingIcon name="refresh" size={14} /> Sócio × decisor</span><strong><MarketingIcon name="check" size={13} /> Match forte</strong></div>
                  <div className="evidence-pills"><span>e-mail corporativo</span><span>celular</span><span>3 evidências</span></div>
                  <div className="lead-progress"><i /></div>
                </div>

                <div className="floating-panel reject-panel"><span>×</span><div><small>FORA DA META</small><strong>E-mail genérico removido</strong></div></div>
                <div className="stage-status"><i /><span>18 fontes avaliadas</span><b>motor ativo</b></div>
              </div>
              <div className="stage-caption"><span>Dados dispersos</span><i /><strong>contexto comercial</strong></div>
            </div>
          </div>
          <div className="scroll-cue" aria-hidden="true"><span>Explore</span><i /></div>
        </section>

        <section className="source-rail" aria-label="Fontes e camadas de inteligência">
          <div className="source-track">
            {[...sources, ...sources].map((source, index) => (
              <div className="source-item" key={`${source.label}-${index}`}>
                <MarketingIcon name={source.icon} size={20} />
                <div><strong>{source.label}</strong><small>{source.detail}</small></div>
              </div>
            ))}
          </div>
        </section>

        <section className="manifesto-section" id="produto">
          <div className="marketing-container">
            <div className="section-kicker" data-reveal><span>01 / O QUE MUDA</span><i /></div>
            <div className="manifesto-heading" data-reveal>
              <h2>Uma lista grande não resolve.<br /><em>Uma lista defensável, sim.</em></h2>
              <p>Bases estáticas mostram quem existe. A EconoSense ajuda a decidir quem merece uma abordagem, combinando fit da empresa, perfil de decisão, qualidade do contato e força das evidências.</p>
            </div>

            <div className="intelligence-bento">
              <article className="bento-card bento-lead" data-reveal>
                <div className="card-coordinate">LEAD / 00482 <span>EXEMPLO</span></div>
                <div className="profile-preview">
                  <div className="profile-top">
                    <span className="company-monogram">NV</span>
                    <div><small>EMPRESA PRIORIZADA</small><h3>Novera Tecnologia Ltda.</h3><p>São Paulo, SP • Software B2B</p></div>
                    <span className="profile-score"><b>92</b><small>score</small></span>
                  </div>
                  <div className="profile-person">
                    <span><MarketingIcon name="user" /></span>
                    <div><small>DECISOR PROVÁVEL</small><strong>Marina Costa · Diretora Comercial</strong><em>Correspondência forte com quadro societário</em></div>
                    <i><MarketingIcon name="check" size={15} /></i>
                  </div>
                  <div className="profile-sources">
                    <span><MarketingIcon name="database" size={14} /> Cadastro oficial</span>
                    <span><MarketingIcon name="linkedin" size={14} /> Sinal profissional</span>
                    <span><MarketingIcon name="globe" size={14} /> Site corporativo</span>
                  </div>
                </div>
                <div className="bento-copy"><span>UM LEAD COM CONTEXTO</span><h3>Não chamamos de qualificado só porque tem e-mail.</h3><p>Cada resultado reúne o que foi encontrado, o que coincidiu e o que ainda merece revisão.</p></div>
              </article>

              <article className="bento-card bento-filter" data-reveal>
                <div className="bento-icon"><MarketingIcon name="target" /></div>
                <span>ICP HIPERPRECISO</span>
                <h3>Você define o corte.</h3>
                <div className="filter-cloud"><span>SP</span><span>Florianópolis</span><span>CNAE 6201-5</span><span>Score ≥ 80</span><span>Celular</span></div>
                <p>Região, atividade e critérios de contato trabalham juntos.</p>
              </article>

              <article className="bento-card bento-goal" data-reveal>
                <div className="goal-rings"><i /><i /><strong>100<small>leads válidos</small></strong></div>
                <div><span>META QUE FAZ SENTIDO</span><h3>Você pede contatos aprovados. O motor processa o resto.</h3></div>
              </article>

              <article className="bento-card bento-reasons" data-reveal>
                <div className="reason-chart">
                  <span style={{ '--bar': '88%' } as CSSProperties}><i /> Match forte <b>+</b></span>
                  <span style={{ '--bar': '73%' } as CSSProperties}><i /> E-mail corporativo <b>+</b></span>
                  <span className="negative" style={{ '--bar': '35%' } as CSSProperties}><i /> Perfil incompleto <b>−</b></span>
                </div>
                <div><span>SCORE EXPLICÁVEL</span><h3>Qualidade visível.<br />Não apenas prometida.</h3></div>
              </article>

              <article className="bento-card bento-export" data-reveal>
                <div className="export-stack"><i /><i /><i><MarketingIcon name="download" /></i></div>
                <span>VOCÊ NO CONTROLE</span><h3>Revise. Selecione. Exporte.</h3><p>Somente os resultados que fazem sentido seguem para o CSV.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="quality-section" id="qualidade">
          <div className="quality-beam" aria-hidden="true" />
          <div className="marketing-container quality-layout">
            <div className="quality-copy" data-reveal>
              <div className="section-kicker light"><span>02 / MOTOR DE QUALIDADE</span><i /></div>
              <h2>Não confie no nosso adjetivo.<br /><em>Abra as evidências.</em></h2>
              <p>A plataforma mostra a origem de cada sinal, explica o score e registra alertas. Assim, seu time decide com mais contexto — e menos fé em planilhas anônimas.</p>
              <div className="quality-points">
                <div><span><MarketingIcon name="refresh" /></span><strong>Sócio × decisor</strong><p>Correspondência probabilística entre quadro societário e perfil profissional.</p></div>
                <div><span><MarketingIcon name="shield" /></span><strong>Validação técnica</strong><p>Classificação de contato corporativo, genérico, celular ou telefone.</p></div>
                <div><span><MarketingIcon name="layers" /></span><strong>Trilha rastreável</strong><p>Fontes, critérios, alertas e motivos de rejeição em uma única leitura.</p></div>
              </div>
              <a className="inline-link" href="#como-funciona">Entender o fluxo completo <MarketingIcon name="arrow" size={17} /></a>
            </div>

            <div className="evidence-console" data-reveal>
              <div className="console-top"><span><i /><i /><i /></span><strong>quality_engine / lead_00482</strong><em>leitura demonstrativa</em></div>
              <div className="console-profile">
                <span className="console-avatar">MC</span>
                <div><small>CONTATO SELECIONADO</small><h3>Marina Costa</h3><p>Diretora Comercial · Novera Tecnologia</p></div>
                <div className="console-score"><strong>92</strong><span><b>ALTA</b><small>confiança</small></span></div>
              </div>
              <div className="console-match">
                <div><small>QUADRO SOCIETÁRIO</small><strong>Marina de A. Costa</strong><span>Fonte cadastral</span></div>
                <div className="match-connector"><i /><span><MarketingIcon name="refresh" size={15} /></span><i /></div>
                <div><small>PERFIL PROFISSIONAL</small><strong>Marina Costa</strong><span>Diretora Comercial</span></div>
              </div>
              <div className="console-evidence">
                <span className="console-label">EVIDÊNCIAS CONSIDERADAS</span>
                <div><span className="evidence-check"><MarketingIcon name="check" size={14} /></span><strong>Domínio corporativo consistente</strong><em>+18</em></div>
                <div><span className="evidence-check"><MarketingIcon name="check" size={14} /></span><strong>Empresa e cargo coincidentes</strong><em>+24</em></div>
                <div><span className="evidence-check"><MarketingIcon name="check" size={14} /></span><strong>Similaridade nominal forte</strong><em>+20</em></div>
                <div className="warning"><span>!</span><strong>Contato requer revisão de uso</strong><em>aviso</em></div>
              </div>
              <div className="console-foot"><span><i /> 3 sinais positivos</span><span>1 alerta operacional</span><strong>Aprovar lead <MarketingIcon name="arrow" size={14} /></strong></div>
            </div>
          </div>
        </section>

        <section className="workflow-section" id="como-funciona">
          <div className="marketing-container">
            <div className="workflow-heading" data-reveal>
              <div className="section-kicker"><span>03 / COMO FUNCIONA</span><i /></div>
              <h2>Do recorte ao arquivo final,<br /><em>sem comprar uma lista no escuro.</em></h2>
            </div>
            <div className="workflow-layout">
              <div className="workflow-steps" data-reveal>
                {workflowSteps.map((step, index) => (
                  <button className={activeStep === index ? 'workflow-step active' : 'workflow-step'} onClick={() => setActiveStep(index)} key={step.number}>
                    <span>{step.number}</span><div><small>{step.caption}</small><strong>{step.title}</strong><p>{step.text}</p></div><i><MarketingIcon name="arrow" size={17} /></i>
                  </button>
                ))}
              </div>
              <div className="workflow-screen" data-reveal>
                <div className="screen-chrome"><BrandLogo inverse compact /><span>Nova busca inteligente</span><i>passo {activeStep + 1} de 4</i></div>
                <div className="screen-body">
                  <div className="screen-progress">{workflowSteps.map((_, index) => <i className={index <= activeStep ? 'complete' : ''} key={index} />)}</div>
                  <span className="screen-step-label">{workflowSteps[activeStep].caption}</span>
                  <h3>{workflowSteps[activeStep].title}</h3>
                  <p>{workflowSteps[activeStep].text}</p>
                  <WorkflowPreview step={activeStep} />
                </div>
                <div className="screen-footer"><span><MarketingIcon name="shield" size={15} /> Critérios salvos automaticamente</span><button>Continuar <MarketingIcon name="arrow" size={15} /></button></div>
              </div>
            </div>
          </div>
        </section>

        <section className="comparison-section">
          <div className="marketing-container" data-reveal>
            <div className="comparison-intro">
              <span>PLANILHA ANÔNIMA</span><strong>→</strong><span className="active">DECISÃO EXPLICÁVEL</span>
            </div>
            <div className="comparison-grid">
              <div className="comparison-copy"><span>O NOVO PADRÃO</span><h2>Pare de comprar listas.<br /><em>Comece a selecionar oportunidades.</em></h2><p>A diferença não está só no volume encontrado, mas no quanto você consegue entender, revisar e defender cada escolha.</p></div>
              <div className="comparison-table">
                <div className="comparison-head"><span>Critério</span><span>Lista pronta</span><span>EconoSense</span></div>
                {[
                  ['Recorte feito para o seu ICP', 'Limitado', 'Configurável'],
                  ['Origem do contato visível', 'Raramente', 'Rastreável'],
                  ['Score e motivos de rejeição', 'Não', 'Incluído'],
                  ['Revisão antes de exportar', 'Manual', 'No fluxo'],
                  ['Meta baseada em leads aprovados', 'Não', 'Sim'],
                ].map((row) => <div className="comparison-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span><MarketingIcon name="check" size={14} /> {row[2]}</span></div>)}
              </div>
            </div>
          </div>
        </section>

        <section className="audience-section" id="para-quem">
          <div className="marketing-container">
            <div className="audience-heading" data-reveal><div><span>04 / PARA QUEM</span><h2>Pipeline cheio.<br /><em>Padrão alto.</em></h2></div><p>Para operações B2B que querem ganhar velocidade sem transformar a qualidade em uma caixa-preta.</p></div>
            <div className="audience-cards">
              {[
                { icon: 'target' as const, title: 'SDRs e BDRs', text: 'Menos tempo triando registros fracos. Mais foco em conversas com fit.' },
                { icon: 'users' as const, title: 'Times comerciais', text: 'Um padrão consistente para abastecer o outbound de toda a equipe.' },
                { icon: 'briefcase' as const, title: 'Agências B2B', text: 'Recortes claros e rastreáveis para diferentes nichos e clientes.' },
                { icon: 'spark' as const, title: 'Fundadores e consultores', text: 'Valide segmentos sem uma pesquisa manual interminável.' },
              ].map((item, index) => <article className="audience-card" data-reveal key={item.title}><span>0{index + 1}</span><i><MarketingIcon name={item.icon} /></i><h3>{item.title}</h3><p>{item.text}</p><a href="/cadastro" aria-label={`Começar como ${item.title}`}><MarketingIcon name="arrow" /></a></article>)}
            </div>
          </div>
        </section>

        <section className="pricing-section" id="precos">
          <div className="pricing-glow" aria-hidden="true" />
          <div className="marketing-container">
            <div className="pricing-heading" data-reveal>
              <div className="section-kicker light"><span>05 / PLANOS</span><i /></div>
              <h2>Planos para alimentar o pipeline.<br /><em>Não uma gaveta de créditos.</em></h2>
              <p>Resultados rejeitados não entram na franquia. O valor acompanha a capacidade da sua operação e o nível de serviço.</p>
              <div className="billing-toggle" role="group" aria-label="Período de cobrança">
                <button className={!annual ? 'active' : ''} onClick={() => setAnnual(false)}>Mensal</button>
                <button className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>Anual <span>2 meses grátis</span></button>
              </div>
            </div>
            <div className="pricing-grid">
              {plans.map((plan) => {
                const price = annual ? plan.annual : plan.monthly;
                return (
                  <article className={plan.featured ? 'price-card featured' : 'price-card'} data-reveal key={plan.name}>
                    {plan.featured && <div className="popular-label"><MarketingIcon name="spark" size={14} /> MELHOR ESCOLHA</div>}
                    <div className="price-card-head"><span>{plan.name}</span><p>{plan.description}</p></div>
                    <div className="price"><small>R$</small><strong>{price.toLocaleString('pt-BR')}</strong><span>/mês</span></div>
                    <div className="billing-caption">{annual ? `R$ ${(price * 12).toLocaleString('pt-BR')} cobrados anualmente` : 'Cobrança mensal, cancele quando quiser'}</div>
                    <div className="plan-volume"><MarketingIcon name="target" size={18} /><strong>{plan.volume}</strong></div>
                    <ul>{plan.features.map((feature) => <li key={feature}><MarketingIcon name="check" size={15} /> {feature}</li>)}</ul>
                    <a className={plan.featured ? 'marketing-button full' : 'marketing-button ghost full'} href={`/cadastro?plano=${plan.name.toLowerCase()}`}>{plan.cta} <MarketingIcon name="arrow" size={17} /></a>
                  </article>
                );
              })}
            </div>
            <div className="pricing-addons" data-reveal>
              <div><span><MarketingIcon name="layers" /></span><strong>Precisa de mais volume?</strong><p>Pacotes adicionais mantêm a operação rodando sem obrigar um upgrade imediato.</p></div>
              <div><span>+500</span><strong>leads aprovados</strong><small>a partir de R$ 397</small></div>
              <div><span>10.000+</span><strong>operação Enterprise</strong><small>capacidade e suporte dedicados</small></div>
              <a href="mailto:comercial@econosense.com.br">Falar com comercial <MarketingIcon name="arrow" size={16} /></a>
            </div>
            <p className="pricing-note">Valores apresentados como proposta comercial da nova versão. A franquia considera leads que passam pelos critérios contratados e são revelados para uso.</p>
          </div>
        </section>

        <section className="responsibility-section">
          <div className="marketing-container responsibility-card" data-reveal>
            <div><span className="responsibility-icon"><MarketingIcon name="shield" size={28} /></span><small>USO RESPONSÁVEL</small><h2>Mais rastreabilidade para uma prospecção consciente.</h2></div>
            <p>A EconoSense oferece fontes visíveis, critérios transparentes e controles de revisão. A adequação à LGPD também depende da finalidade, base legal, retenção e forma de abordagem definidas pela sua organização.</p>
            <a href="#faq">Entender os limites <MarketingIcon name="arrow" size={16} /></a>
          </div>
        </section>

        <section className="faq-section" id="faq">
          <div className="marketing-container faq-layout">
            <div className="faq-heading" data-reveal><span>06 / DÚVIDAS</span><h2>Antes da sua<br /><em>primeira busca.</em></h2><p>Transparência também faz parte do produto. Aqui estão as respostas sem letras miúdas.</p><a href="mailto:suporte@econosense.com.br">Ainda tem dúvidas? Fale com a gente <MarketingIcon name="arrow" size={16} /></a></div>
            <div className="faq-list" data-reveal>
              {faqs.map((faq, index) => <details key={faq.question} open={index === 0}><summary><span>0{index + 1}</span><strong>{faq.question}</strong><i><MarketingIcon name="chevron" /></i></summary><p>{faq.answer}</p></details>)}
            </div>
          </div>
        </section>

        <section className="final-cta-section">
          <div className="final-cta-grid" aria-hidden="true" />
          <div className="final-orbit" aria-hidden="true"><i /><i /><i /></div>
          <div className="marketing-container final-cta" data-reveal>
            <span><MarketingIcon name="spark" size={16} /> SEU PRÓXIMO MERCADO JÁ ESTÁ DEIXANDO SINAIS</span>
            <h2>Seu ICP entra.<br /><em>Uma lista explicável sai.</em></h2>
            <p>Comece com 10 leads aprovados, abra cada evidência e decida com seus próprios olhos.</p>
            <div><a className="marketing-button hero-primary" href="/cadastro">Criar conta grátis <MarketingIcon name="arrow" /></a><small>Sem cartão • Configuração em poucos minutos</small></div>
          </div>
        </section>
      </main>

      <footer className="marketing-footer">
        <div className="marketing-container footer-main">
          <div className="footer-brand"><BrandLogo inverse /><p>Inteligência de prospecção B2B com score, fontes e evidências para você decidir com mais segurança.</p><span>Qualidade visível. Não apenas prometida.</span></div>
          <div><strong>Produto</strong><a href="#produto">Visão geral</a><a href="#qualidade">Motor de qualidade</a><a href="#como-funciona">Como funciona</a><a href="#precos">Preços</a></div>
          <div><strong>Recursos</strong><a href="#para-quem">Para quem</a><a href="#faq">FAQ</a><a href="mailto:suporte@econosense.com.br">Suporte</a><a href="/login">Entrar</a></div>
          <div><strong>Legal</strong><a href="#faq">Privacidade</a><a href="#faq">Termos de uso</a><a href="#faq">Uso responsável</a><a href="mailto:contato@econosense.com.br">Contato</a></div>
        </div>
        <div className="marketing-container footer-bottom"><span>© 2026 EconoSense. Todos os direitos reservados.</span><span><i /> Sistema operacional</span><span>Brasil • B2B intelligence</span></div>
      </footer>
    </div>
  );
}

function WorkflowPreview({ step }: { step: number }) {
  if (step === 0) return <div className="workflow-preview market"><label>Estado / UF<strong>São Paulo</strong></label><label>Cidade<strong>Todo o estado</strong></label><label className="wide">Atividades econômicas<span><i>6201-5/01</i><i>6204-0/00</i><i>+ 3 CNAEs</i></span></label></div>;
  if (step === 1) return <div className="workflow-preview criteria-preview"><label>Qualidade mínima <strong>Alto</strong><span><i /></span></label><div><span><i><MarketingIcon name="check" size={12} /></i> Exigir e-mail corporativo</span><span><i><MarketingIcon name="check" size={12} /></i> Match sócio × decisor</span><span><i /> Exigir apenas celular</span></div></div>;
  if (step === 2) return <div className="workflow-preview processing"><div className="processing-core"><i /><i /><i /><strong>67%</strong></div><div><span><i /> Candidatas avaliadas <b>348</b></span><span><i /> Sinais cruzados <b>1.042</b></span><span><i /> Leads aprovados <b>67</b></span></div></div>;
  return <div className="workflow-preview export-preview-marketing"><div><span className="lead-avatar small">MC</span><strong>Marina Costa<small>Score 92 • 3 evidências</small></strong><i><MarketingIcon name="check" size={13} /></i></div><div><span className="lead-avatar small alt">RF</span><strong>Rafael Freitas<small>Score 87 • 4 evidências</small></strong><i><MarketingIcon name="check" size={13} /></i></div><button><MarketingIcon name="download" size={15} /> Exportar selecionados</button></div>;
}
