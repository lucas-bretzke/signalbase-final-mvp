import { useEffect, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { MarketingIcon, MarketingIconName } from './MarketingIcon';
import './marketing.css';

const benefits: Array<{ icon: MarketingIconName; title: string; text: string }> = [
  {
    icon: 'layers',
    title: 'Dados multifuente',
    text: 'Cruzamento de dados governamentais, LinkedIn e sites empresariais.',
  },
  {
    icon: 'user',
    title: 'Empresas e decisores',
    text: 'Identificação do CNPJ certo e de quem pode participar da decisão.',
  },
  {
    icon: 'chart',
    title: 'Score com evidências',
    text: 'Cada nota vem acompanhada dos sinais, fontes e alertas considerados.',
  },
  {
    icon: 'eye',
    title: 'Revisão antes do uso',
    text: 'Seu time aprova os resultados antes de exportar para o CRM.',
  },
];

const workflowSteps: Array<{ icon: MarketingIconName; title: string; text: string }> = [
  {
    icon: 'target',
    title: 'Defina o mercado',
    text: 'Escolha localização, CNAEs e volume para transformar seu ICP em um recorte objetivo.',
  },
  {
    icon: 'filter',
    title: 'Configure a qualidade',
    text: 'Defina score mínimo e os critérios de empresa, decisor e contato que devem ser atendidos.',
  },
  {
    icon: 'refresh',
    title: 'Cruze as fontes',
    text: 'O motor processa os dados, reúne evidências e separa os resultados fora das regras.',
  },
  {
    icon: 'download',
    title: 'Revise e exporte',
    text: 'Confira score, fontes e alertas. Aprove os leads e exporte um CSV para o seu fluxo comercial.',
  },
];

const audiences: Array<{ icon: MarketingIconName; title: string; text: string }> = [
  { icon: 'target', title: 'SDRs e BDRs', text: 'Menos tempo pesquisando; mais tempo em conversas com fit.' },
  { icon: 'users', title: 'Times comerciais', text: 'Um padrão de qualidade para abastecer todo o outbound.' },
  { icon: 'briefcase', title: 'Agências B2B', text: 'Buscas rastreáveis para diferentes nichos e clientes.' },
  { icon: 'spark', title: 'Fundadores e consultores', text: 'Validação de mercados sem pesquisa manual interminável.' },
];

const plans = [
  {
    name: 'Essencial',
    monthly: 297,
    annual: 247,
    volume: '300',
    description: 'Para iniciar uma operação outbound.',
    features: ['1 usuário', 'Filtros por região e CNAE', 'Score, fontes e evidências', 'Revisão e exportação CSV'],
    cta: 'Começar no Essencial',
  },
  {
    name: 'Growth',
    monthly: 697,
    annual: 580,
    volume: '1.000',
    description: 'Para manter o pipeline do time abastecido.',
    features: ['Até 5 usuários', 'Filtros avançados', 'Buscas e critérios salvos', 'Processamento prioritário', 'Rollover de até 2 mensalidades'],
    cta: 'Escolher Growth',
    featured: true,
  },
  {
    name: 'Scale',
    monthly: 1697,
    annual: 1414,
    volume: '3.500',
    description: 'Para múltiplos mercados, clientes ou squads.',
    features: ['Até 10 usuários', 'Grandes exportações', 'Processamento prioritário', 'Onboarding assistido', 'Suporte prioritário'],
    cta: 'Escolher Scale',
  },
];

const faqs = [
  {
    question: 'Posso testar antes de contratar?',
    answer: 'Sim. Você pode gerar 10 leads aprovados, abrir as evidências e conhecer o fluxo sem cadastrar cartão.',
  },
  {
    question: 'O que é um lead aprovado?',
    answer: 'É um resultado que atingiu o score mínimo e passou pelos critérios definidos na busca. A validação de contato é técnica e não garante entregabilidade, titularidade ou consentimento.',
  },
  {
    question: 'De onde vêm os dados?',
    answer: 'De dados cadastrais públicos, sites corporativos e sinais profissionais disponíveis em fontes como o LinkedIn, conforme disponibilidade, permissões e termos aplicáveis.',
  },
  {
    question: 'Resultados rejeitados consomem a franquia?',
    answer: 'Não. A franquia considera os leads aprovados e revelados para uso. Resultados rejeitados pelos critérios da busca não são descontados.',
  },
  {
    question: 'Como funciona a relação com a LGPD?',
    answer: 'A EconoSense oferece origem dos dados visível, critérios transparentes e controles de revisão para apoiar o uso responsável. A adequação também depende da finalidade, base legal, retenção e abordagem definidas pela sua organização.',
  },
  {
    question: 'Posso exportar ou integrar os contatos ao CRM?',
    answer: 'Você pode revisar os resultados e exportar um CSV estruturado para organizar ou importar no seu CRM. Integrações específicas dependem do fluxo adotado pela sua operação.',
  },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerSolid, setHeaderSolid] = useState(false);
  const [annual, setAnnual] = useState(true);

  useEffect(() => {
    const updateHeader = () => setHeaderSolid(window.scrollY > 16);
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
    window.addEventListener('keydown', closeMenuOnEscape);

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible');
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' });
    document.querySelectorAll('[data-reveal]').forEach((node) => observer.observe(node));

    return () => {
      window.removeEventListener('scroll', updateHeader);
      window.removeEventListener('keydown', closeMenuOnEscape);
      observer.disconnect();
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="marketing-page">
      <header className={`marketing-header ${headerSolid ? 'solid' : ''}`}>
        <a className="marketing-logo-link" href="#inicio" aria-label="EconoSense — início" onClick={closeMenu}>
          <BrandLogo inverse />
        </a>
        <nav id="marketing-navigation" className={menuOpen ? 'marketing-nav open' : 'marketing-nav'} aria-label="Navegação principal">
          <a href="#produto" onClick={closeMenu}>Produto</a>
          <a href="#como-funciona" onClick={closeMenu}>Como funciona</a>
          <a href="#para-quem" onClick={closeMenu}>Para quem</a>
          <a href="#precos" onClick={closeMenu}>Preços</a>
          <a href="#faq" onClick={closeMenu}>FAQ</a>
        </nav>
        <div className="marketing-header-actions">
          <a className="header-login" href="/login">Entrar</a>
          <a className="marketing-button small" href="/cadastro">Criar busca grátis</a>
          <button
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
            aria-controls="marketing-navigation"
          >
            <MarketingIcon name={menuOpen ? 'close' : 'menu'} size={22} />
          </button>
        </div>
      </header>

      <main>
        <section className="hero-section" id="inicio">
          <div className="hero-grid" aria-hidden="true" />
          <div className="marketing-container hero-layout">
            <div className="hero-copy" data-reveal>
              <span className="eyebrow"><i /> Inteligência de prospecção B2B</span>
              <h1>Encontre empresas e decisores que atendem ao seu ICP.</h1>
              <p>A EconoSense cruza dados cadastrais, profissionais e corporativos para entregar leads B2B com score, fontes e evidências.</p>
              <div className="hero-actions">
                <a className="marketing-button primary" href="/cadastro">Criar busca grátis <MarketingIcon name="arrow" size={18} /></a>
                <a className="text-link light" href="#produto">Ver exemplo de lead <MarketingIcon name="arrow" size={16} /></a>
              </div>
              <div className="hero-assurances" aria-label="Condições do teste">
                <span><MarketingIcon name="check" size={15} /> 10 leads aprovados</span>
                <span><MarketingIcon name="check" size={15} /> Sem cartão</span>
                <span><MarketingIcon name="check" size={15} /> Revise antes de exportar</span>
              </div>
            </div>

            <div className="hero-search-card" data-reveal aria-label="Exemplo de configuração de busca">
              <div className="search-card-top">
                <span><MarketingIcon name="search" size={17} /> Nova busca</span>
                <small>Exemplo de interface</small>
              </div>
              <div className="search-card-body">
                <div className="search-field wide"><small>Mercado</small><strong>Software B2B em São Paulo</strong></div>
                <div className="search-field"><small>CNAE</small><strong>6201-5/01 <span>+2</span></strong></div>
                <div className="search-field"><small>Meta</small><strong>100 leads</strong></div>
                <div className="search-rules">
                  <span><i><MarketingIcon name="check" size={12} /></i> Score mínimo 80</span>
                  <span><i><MarketingIcon name="check" size={12} /></i> E-mail corporativo</span>
                  <span><i><MarketingIcon name="check" size={12} /></i> Possível decisor</span>
                </div>
                <div className="search-summary">
                  <div><small>Empresas no recorte</small><strong>2.481</strong></div>
                  <div><small>Fontes a cruzar</small><strong>3 camadas</strong></div>
                </div>
                <button type="button" tabIndex={-1}>Processar busca <MarketingIcon name="arrow" size={16} /></button>
              </div>
            </div>
          </div>
        </section>

        <section className="product-section" id="produto">
          <div className="marketing-container">
            <div className="section-heading centered" data-reveal>
              <span className="eyebrow"><i /> Demonstração do produto</span>
              <h2>Veja por que cada lead foi aprovado.</h2>
              <p>Empresa, decisor, contatos, score e origem dos dados em uma única tela.</p>
            </div>

            <div className="product-window" data-reveal>
              <div className="product-window-bar">
                <div><BrandLogo inverse compact /><span>Resultado da busca</span></div>
                <span className="result-count">1 de 100 aprovados</span>
              </div>
              <div className="lead-workspace">
                <aside className="lead-list" aria-label="Lista de leads de exemplo">
                  <div className="lead-list-title"><span>Leads aprovados</span><strong>100</strong></div>
                  <div className="lead-list-item active"><span>NV</span><div><strong>Novera Tecnologia</strong><small>São Paulo, SP</small></div><b>92</b></div>
                  <div className="lead-list-item"><span>AL</span><div><strong>Alto Sistemas</strong><small>Campinas, SP</small></div><b>88</b></div>
                  <div className="lead-list-item"><span>TR</span><div><strong>Tria Cloud</strong><small>Barueri, SP</small></div><b>84</b></div>
                </aside>

                <article className="lead-detail">
                  <div className="company-row">
                    <span className="company-mark">NV</span>
                    <div><small>EMPRESA ENCONTRADA</small><h3>Novera Tecnologia Ltda.</h3><p>CNPJ 12.345.678/0001-90 · São Paulo, SP · CNAE 6201-5/01</p></div>
                    <div className="lead-score"><strong>92</strong><span>Score alto</span></div>
                  </div>

                  <div className="decision-maker">
                    <span className="person-mark">MC</span>
                    <div><small>POSSÍVEL DECISORA</small><h4>Marina Costa</h4><p>Diretora Comercial · vínculo profissional encontrado</p></div>
                    <span className="match-badge"><MarketingIcon name="check" size={14} /> Match forte</span>
                  </div>

                  <div className="lead-columns">
                    <div className="contact-panel">
                      <h5>Contatos disponíveis</h5>
                      <div><span><MarketingIcon name="mail" size={16} /></span><p><small>E-mail corporativo</small><strong>marina@novera.com.br</strong></p><i>validado</i></div>
                      <div><span><MarketingIcon name="phone" size={16} /></span><p><small>Celular</small><strong>(11) 9••••-1180</strong></p><i>encontrado</i></div>
                      <div><span><MarketingIcon name="globe" size={16} /></span><p><small>Domínio corporativo</small><strong>novera.com.br</strong></p><i>compatível</i></div>
                    </div>

                    <div className="evidence-panel">
                      <h5>Evidências do score</h5>
                      <div><span><MarketingIcon name="check" size={13} /></span><p><strong>Empresa atende ao recorte</strong><small>Localização e CNAE confirmados</small></p><b>+30</b></div>
                      <div><span><MarketingIcon name="check" size={13} /></span><p><strong>Cargo com poder de decisão</strong><small>Perfil profissional compatível</small></p><b>+24</b></div>
                      <div><span><MarketingIcon name="check" size={13} /></span><p><strong>Contato corporativo</strong><small>Domínio associado ao site oficial</small></p><b>+18</b></div>
                    </div>
                  </div>

                  <div className="lead-bottom-row">
                    <div className="source-chips" aria-label="Fontes consultadas">
                      <span><MarketingIcon name="database" size={14} /> Dados governamentais</span>
                      <span><MarketingIcon name="linkedin" size={14} /> LinkedIn</span>
                      <span><MarketingIcon name="globe" size={14} /> Site corporativo</span>
                    </div>
                    <div className="lead-alert"><strong>Alerta</strong><span>Confirme a base legal e a finalidade antes da abordagem.</span></div>
                  </div>
                </article>
              </div>
              <div className="product-window-footer"><span><MarketingIcon name="eye" size={15} /> Revise cada resultado antes de usar</span><button type="button" tabIndex={-1}>Aprovar e exportar</button></div>
            </div>

            <div className="benefit-grid">
              {benefits.map((benefit) => (
                <article data-reveal key={benefit.title}>
                  <span><MarketingIcon name={benefit.icon} size={21} /></span>
                  <h3>{benefit.title}</h3>
                  <p>{benefit.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="quality-section" id="qualidade">
          <div className="marketing-container quality-layout">
            <div className="quality-copy" data-reveal>
              <span className="eyebrow"><i /> Motor de qualidade</span>
              <h2>Dados cruzados. Critérios claros. Decisão humana.</h2>
              <p>O motor avalia empresa, decisor e contato. O score resume a qualidade; as evidências mostram o que sustentou a nota e os alertas indicam o que merece atenção.</p>
              <a className="text-link" href="#como-funciona">Entender o processo <MarketingIcon name="arrow" size={16} /></a>
            </div>
            <div className="quality-flow" data-reveal>
              <div><span><MarketingIcon name="layers" size={20} /></span><p><small>01</small><strong>Cruza as fontes</strong><em>Cadastro, profissionais e web</em></p></div>
              <i aria-hidden="true" />
              <div><span><MarketingIcon name="chart" size={20} /></span><p><small>02</small><strong>Calcula o score</strong><em>Empresa, decisor e contato</em></p></div>
              <i aria-hidden="true" />
              <div><span><MarketingIcon name="eye" size={20} /></span><p><small>03</small><strong>Explica o resultado</strong><em>Evidências, fontes e alertas</em></p></div>
            </div>
          </div>
        </section>

        <section className="workflow-section" id="como-funciona">
          <div className="marketing-container">
            <div className="section-heading" data-reveal>
              <span className="eyebrow"><i /> Como funciona</span>
              <h2>Da definição do mercado à exportação.</h2>
              <p>Quatro etapas para gerar uma lista alinhada aos seus critérios.</p>
            </div>
            <div className="workflow-grid">
              {workflowSteps.map((step, index) => (
                <article data-reveal key={step.title}>
                  <div><span>0{index + 1}</span><i><MarketingIcon name={step.icon} size={20} /></i></div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="comparison-section">
          <div className="marketing-container comparison-layout">
            <div className="comparison-copy" data-reveal>
              <span className="eyebrow"><i /> Comparação direta</span>
              <h2>Mais controle do que em uma lista pronta.</h2>
              <p>Você define o recorte, verifica a origem e paga pelos resultados que passaram pelos seus critérios.</p>
            </div>
            <div className="comparison-table" data-reveal role="table" aria-label="Comparação entre lista pronta e EconoSense">
              <div className="comparison-head" role="row"><span role="columnheader">Critério</span><span role="columnheader">Lista pronta</span><span role="columnheader">EconoSense</span></div>
              {[
                ['Filtros para o seu ICP', 'Limitados', 'Configuráveis'],
                ['Origem dos dados', 'Pouco visível', 'Visível'],
                ['Decisores', 'Nem sempre', 'Identificados'],
                ['Score e evidências', 'Não', 'Incluídos'],
                ['Revisão antes de exportar', 'Fora do fluxo', 'No produto'],
                ['Cobrança', 'Pelo volume comprado', 'Por leads aprovados'],
              ].map((row) => (
                <div className="comparison-row" role="row" key={row[0]}>
                  <strong role="cell">{row[0]}</strong><span role="cell">{row[1]}</span><span role="cell"><MarketingIcon name="check" size={14} /> {row[2]}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="audience-section" id="para-quem">
          <div className="marketing-container">
            <div className="section-heading centered" data-reveal>
              <span className="eyebrow"><i /> Para quem</span>
              <h2>Para quem precisa gerar pipeline B2B.</h2>
            </div>
            <div className="audience-grid">
              {audiences.map((item) => (
                <article data-reveal key={item.title}>
                  <span><MarketingIcon name={item.icon} size={20} /></span>
                  <div><h3>{item.title}</h3><p>{item.text}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="pricing-section" id="precos">
          <div className="marketing-container">
            <div className="pricing-heading" data-reveal>
              <div>
                <span className="eyebrow"><i /> Planos</span>
                <h2>Pague pelos leads aprovados.</h2>
                <p>Resultados rejeitados pelos seus critérios não consomem a franquia.</p>
              </div>
              <div className="billing-control">
                <div className="billing-toggle" role="group" aria-label="Período de cobrança">
                  <button className={!annual ? 'active' : ''} onClick={() => setAnnual(false)} aria-pressed={!annual}>Mensal</button>
                  <button className={annual ? 'active' : ''} onClick={() => setAnnual(true)} aria-pressed={annual}>Anual</button>
                </div>
                <small>{annual ? 'Valor mensal no plano anual' : 'Cobrança mês a mês'}</small>
              </div>
            </div>

            <div className="pricing-grid">
              {plans.map((plan) => {
                const price = annual ? plan.annual : plan.monthly;
                return (
                  <article className={plan.featured ? 'price-card featured' : 'price-card'} data-reveal key={plan.name}>
                    {plan.featured && <span className="popular-label">Mais escolhido</span>}
                    <div className="price-card-heading"><h3>{plan.name}</h3><p>{plan.description}</p></div>
                    <div className="price"><small>R$</small><strong>{price.toLocaleString('pt-BR')}</strong><span>/mês</span></div>
                    <p className="billing-caption">{annual ? `R$ ${(price * 12).toLocaleString('pt-BR')} cobrados por ano` : 'Cobrança mensal'}</p>
                    <div className="plan-volume"><strong>{plan.volume}</strong><span>leads aprovados / mês</span></div>
                    <ul>{plan.features.map((feature) => <li key={feature}><MarketingIcon name="check" size={15} /> {feature}</li>)}</ul>
                    <a className={plan.featured ? 'marketing-button primary full' : 'marketing-button secondary full'} href={`/cadastro?plano=${plan.name.toLowerCase()}`}>{plan.cta}</a>
                  </article>
                );
              })}
            </div>

            <div className="pricing-extras" data-reveal>
              <div><span>+500</span><p><strong>Leads adicionais</strong><small>A partir de R$ 397</small></p></div>
              <div><span>10.000+</span><p><strong>Enterprise</strong><small>Capacidade e suporte dedicados</small></p></div>
              <a className="text-link light" href="mailto:comercial@econosense.com.br">Falar com comercial <MarketingIcon name="arrow" size={16} /></a>
            </div>
            <p className="rollover-note"><MarketingIcon name="refresh" size={15} /> No plano Growth, créditos não usados acumulam por até 2 mensalidades.</p>
          </div>
        </section>

        <section className="faq-section" id="faq">
          <div className="marketing-container faq-layout">
            <div className="faq-heading" data-reveal>
              <span className="eyebrow"><i /> Perguntas frequentes</span>
              <h2>O que saber antes de começar.</h2>
              <p>Respostas diretas sobre teste, dados, cobrança e uso responsável.</p>
              <a className="text-link" href="mailto:suporte@econosense.com.br">Falar com o suporte <MarketingIcon name="arrow" size={16} /></a>
            </div>
            <div className="faq-list" data-reveal>
              {faqs.map((faq, index) => (
                <details key={faq.question} open={index === 0}>
                  <summary><strong>{faq.question}</strong><span><MarketingIcon name="chevron" size={18} /></span></summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta-section">
          <div className="marketing-container final-cta" data-reveal>
            <span className="eyebrow"><i /> Teste gratuito</span>
            <h2>Crie sua primeira busca e avalie os resultados.</h2>
            <p>Gere 10 leads aprovados, revise as evidências e exporte quando estiver seguro.</p>
            <a className="marketing-button primary" href="/cadastro">Começar sem cartão <MarketingIcon name="arrow" size={18} /></a>
          </div>
        </section>
      </main>

      <footer className="marketing-footer">
        <div className="marketing-container footer-main">
          <div className="footer-brand"><BrandLogo inverse /><p>Prospecção B2B com score, fontes e evidências.</p></div>
          <div><strong>Produto</strong><a href="#produto">Demonstração</a><a href="#qualidade">Motor de qualidade</a><a href="#como-funciona">Como funciona</a></div>
          <div><strong>Empresa</strong><a href="#para-quem">Para quem</a><a href="#precos">Preços</a><a href="#faq">FAQ</a></div>
          <div><strong>Acesso</strong><a href="/login">Entrar</a><a href="/cadastro">Criar busca grátis</a><a href="mailto:contato@econosense.com.br">Contato</a></div>
        </div>
        <div className="marketing-container footer-bottom"><span>© 2026 EconoSense. Todos os direitos reservados.</span><span>Brasil · Inteligência B2B</span></div>
      </footer>
    </div>
  );
}
