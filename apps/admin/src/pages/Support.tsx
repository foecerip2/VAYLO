import { SupportDesk, type SupportTransport } from '@vpn/support';
import { useAuth } from '../lib/auth';
import { get,post,patch,put,del,loadSupportPhoto } from '../lib/api';
const api:SupportTransport={get,post,patch,put,del,loadSupportPhoto};
export default function SupportPage(){const {me}=useAuth();return <SupportDesk api={api} role={me?.role??'analyst'}/>;}
