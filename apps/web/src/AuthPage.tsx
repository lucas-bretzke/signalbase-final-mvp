import { FormEvent, useMemo, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { MarketingIcon, type MarketingIconName } from './MarketingIcon';
import './auth.css';

export type AuthMode = 'login' | 'signup';

export default function AuthPage({ mode }: { mode: AuthMode }) {
  const signup = mode === 'signup';
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'info'; message: string }>();
  const selectedPlan = useMemo(() => {
    const plan = new URLSearchParams(window.location.search).get('plano');
    return plan ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : undefined;
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    if (password.length < 8) {
      setStatus({ tone: 'error', message: 'Use uma senha com pelo menos 8 caracteres.' });
      return;
    }
    if (signup && !form.get('terms')) {
      setStatus({ tone: 'error', message: 'Aceite os termos para continuar.' });
      return;
    }
    setStatus({
      tone: 'info',
      message: signup
        ? 'Cadastro visual concluído. A criação real da conta será conectada à API na próxima etapa.'
        : 'Login visual concluído. A autenticação real será conectada à API na próxima etapa.',
    });
  }

  return (
    <main className="auth-page">
      <div className="auth-noise" aria-hidden="true" />
      <div className="auth-grid" aria-hidden="true" />
      <a className="auth-back" href="/"><MarketingIcon name="arrow" size={17} /> Voltar para o site</a>
      <a className="auth-logo" href="/" aria-label="EconoSense — início"><BrandLogo inverse /></a>

      <section className="auth-story" aria-label="Benefícios da EconoSense">
        <div className="auth-story-copy">
          <span><MarketingIcon name="spark" size={16} /> INTELIGÊNCIA COMERCIAL EXPLICÁVEL</span>
          <h1>{signup ? <>Comece com um recorte.<br /><em>Termine com confiança.</em></> : <>Volte para uma prospecção<br /><em>que explica cada lead.</em></>}</h1>
          <p>{signup ? 'Defina seu padrão de qualidade, deixe o motor cruzar os sinais e revise cada evidência antes de exportar.' : 'Continue de onde parou: acompanhe suas buscas, abra score e evidências e selecione os contatos que merecem uma conversa.'}</p>
        </div>

        <div className="auth-orbit" aria-hidden="true">
          <i className="auth-ring one" /><i className="auth-ring two" />
          <div className="auth-engine">
            <span /><span /><span /><span /><span />
          </div>
          <div className="auth-source auth-source-one"><MarketingIcon name="database" size={17} /><div><small>CAMADA 01</small><strong>Cadastro oficial</strong></div><i /></div>
          <div className="auth-source auth-source-two"><MarketingIcon name="linkedin" size={17} /><div><small>CAMADA 02</small><strong>Sinal profissional</strong></div><i /></div>
          <div className="auth-result"><span>MC</span><div><small>LEAD APROVADO</small><strong>Marina Costa</strong><em>3 evidências encontradas</em></div><b>92</b></div>
        </div>

        <div className="auth-benefits">
          {(signup ? [
            ['target' as const, 'Escolha região e atividade econômica'],
            ['shield' as const, 'Defina score e critérios de qualidade'],
            ['layers' as const, 'Receba resultados revisáveis e explicados'],
          ] : [
            ['search' as const, 'Acompanhe buscas e metas de contatos válidos'],
            ['chart' as const, 'Revise score, match e evidências'],
            ['download' as const, 'Selecione antes de exportar'],
          ]).map(([icon, text]) => <span key={text}><i><MarketingIcon name={icon as MarketingIconName} size={16} /></i>{text}</span>)}
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-card">
          <div className="auth-card-beam" aria-hidden="true" />
          <div className="auth-card-heading">
            {selectedPlan && signup && <span className="selected-plan"><MarketingIcon name="spark" size={13} /> Plano {selectedPlan} selecionado</span>}
            <small>{signup ? 'SUA PRIMEIRA BUSCA COMEÇA AQUI' : 'BEM-VINDO DE VOLTA'}</small>
            <h2>{signup ? 'Crie sua conta' : 'Acesse a EconoSense'}</h2>
            <p>{signup ? 'Teste a EconoSense com 10 leads, sem cartão.' : 'Entre para continuar de onde parou.'}</p>
          </div>

          <form className="auth-form" onSubmit={submit} noValidate={false}>
            {signup && (
              <div className="auth-field-row">
                <label className="auth-field"><span>Nome completo</span><div><MarketingIcon name="user" size={17} /><input name="name" type="text" placeholder="Seu nome" autoComplete="name" required /></div></label>
                <label className="auth-field"><span>Empresa</span><div><MarketingIcon name="building" size={17} /><input name="company" type="text" placeholder="Nome da empresa" autoComplete="organization" required /></div></label>
              </div>
            )}

            <label className="auth-field">
              <span>{signup ? 'E-mail profissional' : 'E-mail'}</span>
              <div><MarketingIcon name="mail" size={17} /><input name="email" type="email" placeholder="voce@empresa.com.br" autoComplete="email" required /></div>
            </label>

            {signup && <label className="auth-field"><span>Telefone <em>opcional</em></span><div><MarketingIcon name="phone" size={17} /><input name="phone" type="tel" placeholder="(00) 00000-0000" autoComplete="tel" /></div></label>}

            <label className="auth-field">
              <span>Senha {signup && <em>mínimo de 8 caracteres</em>}</span>
              <div><MarketingIcon name="lock" size={17} /><input name="password" type={showPassword ? 'text' : 'password'} placeholder={signup ? 'Crie uma senha segura' : 'Digite sua senha'} autoComplete={signup ? 'new-password' : 'current-password'} minLength={8} required /><button type="button" onClick={() => setShowPassword((show) => !show)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}><MarketingIcon name={showPassword ? 'eye-off' : 'eye'} size={18} /></button></div>
            </label>

            {signup ? (
              <label className="auth-check"><input name="terms" type="checkbox" /><i><MarketingIcon name="check" size={12} /></i><span>Li e aceito os <a href="/#faq">Termos de uso</a> e a <a href="/#faq">Política de privacidade</a>.</span></label>
            ) : (
              <div className="auth-form-options"><label className="auth-check"><input name="remember" type="checkbox" /><i><MarketingIcon name="check" size={12} /></i><span>Lembrar de mim</span></label><a href="mailto:suporte@econosense.com.br">Esqueci minha senha</a></div>
            )}

            {status && <div className={`auth-message ${status.tone}`} role="status" aria-live="polite"><span>{status.tone === 'error' ? '!' : 'i'}</span><p>{status.message}</p></div>}

            <button className="auth-submit" type="submit">{signup ? 'Criar conta grátis' : 'Entrar na plataforma'} <MarketingIcon name="arrow" size={18} /></button>
          </form>

          <div className="auth-switch">
            <span>{signup ? 'Já tem uma conta?' : 'Ainda não tem conta?'}</span>
            <a href={signup ? '/login' : '/cadastro'}>{signup ? 'Fazer login' : 'Criar gratuitamente'} <MarketingIcon name="arrow" size={14} /></a>
          </div>
          <div className="auth-security"><MarketingIcon name="shield" size={14} /> Seus dados não são enviados enquanto a API de autenticação não estiver conectada.</div>
        </div>
      </section>

      <div className="auth-footer"><span>© 2026 EconoSense</span><span><i /> Ambiente protegido</span><a href="mailto:suporte@econosense.com.br">Precisa de ajuda?</a></div>
    </main>
  );
}
