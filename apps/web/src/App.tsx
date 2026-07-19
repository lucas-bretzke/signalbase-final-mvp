import { lazy, Suspense, useEffect } from 'react';

const LandingPage = lazy(() => import('./LandingPage'));
const AuthPage = lazy(() => import('./AuthPage'));
const ProductApp = lazy(() => import('./ProductApp'));

function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const isProductRoute = path === '/app' || path === '/searches' || path.startsWith('/searches/') || path === '/exports';
  const isLogin = path === '/login';
  const isSignup = path === '/cadastro';

  useEffect(() => {
    if (isLogin) document.title = 'Entrar | EconoSense';
    else if (isSignup) document.title = 'Criar conta | EconoSense';
    else if (isProductRoute) document.title = 'EconoSense | Lead Intelligence';
    else document.title = 'EconoSense | Inteligência de prospecção B2B';
  }, [isLogin, isProductRoute, isSignup]);

  return (
    <Suspense fallback={<RouteLoader />}>
      {isLogin ? <AuthPage mode="login" /> : isSignup ? <AuthPage mode="signup" /> : isProductRoute ? <ProductApp /> : <LandingPage />}
    </Suspense>
  );
}

function RouteLoader() {
  return (
    <div className="route-loader" role="status" aria-label="Carregando EconoSense">
      <span><i /><i /><i /><i /><i /></span>
      <strong>EconoSense</strong>
    </div>
  );
}

export default App;
