// P0 user-management endpoints. Keep authorization server-side and avoid Master_Users full scan for ID generation.
function p0CreateUserAccount(token, userAgent, email, fullName, role) {
  var auth = p0Session_(token, userAgent, 'admin');
  if (!auth.ok) return { success:false, message:auth.message };

  var cleanEmail = String(email || '').trim().toLowerCase();
  var cleanName = String(fullName || '').trim();
  var cleanRole = String(role || '').trim();
  if (!cleanEmail || cleanEmail.indexOf('@') === -1) return { success:false, message:'กรุณากรอกอีเมลให้ถูกต้อง' };
  if (!cleanName) return { success:false, message:'กรุณากรอกชื่อเต็ม' };
  if (['viewer','staff','admin'].indexOf(cleanRole) === -1) return { success:false, message:'กรุณาเลือกสิทธิ์ผู้ใช้ให้ถูกต้อง' };
  if (findUserByEmail_(cleanEmail)) return { success:false, message:'อีเมลนี้มีบัญชีผู้ใช้อยู่แล้วในระบบ' };

  var username = generateUsernameFromEmail_(cleanEmail);
  var tempPassword = generateTempPassword_();
  var salt = makeSalt_();
  var rid = p0ReserveNextMasterId_(AUTH_USERS_COLLECTION, 'U');
  if (!rid.ok) return { success:false, message:rid.message };

  var dataObject = {
    Username:username, Full_Name:cleanName, Email:cleanEmail,
    Password_Hash:hashPassword_(tempPassword,salt), Salt:salt,
    Role:cleanRole, Status:'Active', Totp_Enabled:'false', Totp_Secret_Enc:'', Recovery_Codes:'[]',
    Failed_Attempts:0, Locked_Until:'', Last_Login:'', Password_Changed_At:'', Must_Change_Password:'true'
  };
  var res = saveMasterData(AUTH_USERS_COLLECTION,'U',rid.id,dataObject,null);
  if (!res.success) return { success:false, message:'สร้างบัญชีไม่สำเร็จ: '+res.message };
  var emailSent = sendAccountEmail_(cleanEmail,cleanName,username,tempPassword,false);
  return {
    success:true,
    message:emailSent?'สร้างบัญชีผู้ใช้สำเร็จ และส่งอีเมลแจ้งรหัสผ่านเรียบร้อยแล้ว':'สร้างบัญชีผู้ใช้สำเร็จ แต่ส่งอีเมลไม่สำเร็จ กรุณาแจ้งรหัสผ่านให้ผู้ใช้ด้วยตนเอง',
    username:username,
    tempPassword:emailSent?undefined:tempPassword,
    id:rid.id,
    user:{docId:rid.id,username:username,fullName:cleanName,email:cleanEmail,role:cleanRole,status:'Active',totpEnabled:false,lastLogin:'',mustChangePassword:true}
  };
}
