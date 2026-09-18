import App from './App';
import { useSpatialNavigation } from './hooks/useSpatialNavigation';

/**
 * 📺 Onde a navegação por setas do Modo TV nasce.
 *
 * `useSpatialNavigation()` — que É o Modo TV no teclado — era montada num
 * lugar só: o `Dashboard`. Só que a PRIMEIRA tela depois do boot é o "Quem
 * está assistindo?", que o `App` devolve ANTES do `<HashRouter>`, e `/welcome`
 * e `/login` são rotas IRMÃS de `/dashboard`. Em nenhuma das três o ouvinte de
 * `keydown` existia: ligar o Modo TV e dar boot deixava as setas mortas
 * justamente na tela de onde ainda não dá para chegar ao Dashboard — e sem um
 * controle na mão (o `useGamepadNavigation`, esse sim, já nascia global) não
 * havia como escolher o perfil.
 *
 * O lugar natural seria o próprio `App`, ao lado do `useGamepadNavigation()`.
 * Como `src/App.tsx` está travado por outro PR, o hook sobe um degrau a mais:
 * este componente, que envolve o `App` inteiro e é o que o `main.tsx`
 * renderiza. O alcance é idêntico (inclusive nas janelas de PiP e MultiView,
 * que montam o mesmo `App`) e, ao contrário do `main.tsx`, dá para montar
 * num teste.
 */
export function RaizDoApp() {
    useSpatialNavigation();
    return <App />;
}
