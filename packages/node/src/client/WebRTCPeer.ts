export class WebRTCPeer {
  private peerConnection: RTCPeerConnection;
  private onTaskResult: (result: any) => void;

  constructor(onTaskResult: (result: any) => void) {
    this.onTaskResult = onTaskResult;
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
  }

  async handleOffer(offer: RTCSessionDescriptionInit, sendAnswer: (answer: RTCSessionDescriptionInit) => void) {
    await this.peerConnection.setRemoteDescription(offer);
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    sendAnswer(answer);
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    await this.peerConnection.addIceCandidate(candidate);
  }
}
